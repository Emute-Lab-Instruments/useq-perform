/**
 * Binding Resolver — merges defaults + overrides, detects conflicts,
 * discovers free keys, and generates CodeMirror keymap extensions.
 *
 * Pure logic — no direct DOM access. Testable in Node/Vitest.
 */

import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { KeyBinding as CMKeyBinding } from "@codemirror/view";

import type { ActionId } from "./actions.ts";
import { getAction } from "./actions.ts";
import {
  defaultKeyBindings,
  type KeyBinding,
} from "./defaults.ts";
import { getHandler, type ActionHandler } from "./handlers.ts";
import { isBrowserReserved, isOsReserved, type ReservedKey } from "./osReserved.ts";
import { whenExpressionsOverlap, evaluateWhen } from "./contexts.ts";
import { recordAction } from "./usageTracker.ts";
import { announceAction } from "./announcer.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedBinding {
  action: ActionId;
  key: string;
  when?: string;
  preventDefault: boolean;
  handler?: ActionHandler;
}

export interface ConflictInfo {
  key: string;
  actions: ActionId[];
  overlappingContexts: boolean;
  osReserved: boolean;
}

export type RebindResult =
  | { status: "ok" }
  | { status: "blocked"; reason: string }
  | { status: "conflict"; displaced: ActionId; suggestions: RebindSuggestion[] };

export type RebindSuggestion =
  | { type: "context-split"; target: string }
  | { type: "swap"; target: string }
  | { type: "chord"; target: string }
  | { type: "nearby"; target: string };

export interface BindingResolver {
  /** Current resolved map of action to binding. */
  resolved(): Map<ActionId, ResolvedBinding>;

  /** Conflict info for a specific key, or null if no conflict. */
  conflictsFor(key: string): ConflictInfo | null;

  /** All detected conflicts. */
  allConflicts(): ConflictInfo[];

  /** Keys that are not bound and not reserved. */
  freeKeys(opts?: { withModifiers?: string[] }): string[];

  /** Attempt to rebind an action to a new key. Mutates internal state on success. */
  rebind(action: ActionId, newKey: string): RebindResult;

  /** Generate CodeMirror keymap Extension array from resolved bindings. */
  toKeymapExtensions(): Extension[];
}

// ---------------------------------------------------------------------------
// Context overlap detection
// ---------------------------------------------------------------------------

// Delegated to contexts.ts — whenExpressionsOverlap handles conjunction
// parsing, negation detection, and conservative overlap analysis.

// ---------------------------------------------------------------------------
// Chord helpers
// ---------------------------------------------------------------------------

/**
 * Returns true if the key string is a chord (multi-stroke) binding.
 * Chords are space-separated key sequences like "Alt-e ]".
 */
export function isChord(key: string): boolean {
  return key.includes(" ");
}

/**
 * Extract the leader key from a chord binding (the first stroke).
 * Returns undefined for non-chord bindings.
 */
export function chordLeader(key: string): string | undefined {
  if (!isChord(key)) return undefined;
  return key.split(" ")[0];
}

/**
 * Suggest a chord target for moving an action into a namespace under the
 * requested key (keybindings.md §1.9, "chord" suggestion). Returns a
 * `<requestedKey> <letter>` chord whose full key string is not already bound,
 * or undefined when the requested key is itself a chord or no slot is free.
 */
export function suggestChordTarget(
  requestedKey: string,
  bindings: KeyBinding[],
): string | undefined {
  if (isChord(requestedKey)) return undefined;
  const boundKeys = new Set(bindings.map((b) => b.key));
  for (const letter of LETTERS) {
    const candidate = `${requestedKey} ${letter}`;
    if (!boundKeys.has(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Get all unique chord leader keys from a set of bindings.
 */
export function getChordLeaders(bindings: KeyBinding[]): Set<string> {
  const leaders = new Set<string>();
  for (const b of bindings) {
    const leader = chordLeader(b.key);
    if (leader !== undefined) leaders.add(leader);
  }
  return leaders;
}

// ---------------------------------------------------------------------------
// Conflict detection
// ---------------------------------------------------------------------------

function detectConflicts(bindings: KeyBinding[]): ConflictInfo[] {
  // Group bindings by key
  const byKey = new Map<string, KeyBinding[]>();
  for (const binding of bindings) {
    const group = byKey.get(binding.key) ?? [];
    group.push(binding);
    byKey.set(binding.key, group);
  }

  const conflicts: ConflictInfo[] = [];

  for (const [key, group] of byKey) {
    if (group.length <= 1) continue;

    // Multiple bindings for the same action on the same key are not
    // conflicts — they're just duplicates (shouldn't happen, but harmless).
    // Only flag if different actions share the same key with overlapping contexts.
    let hasOverlap = false;
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        if (
          group[i].action !== group[j].action &&
          whenExpressionsOverlap(group[i].when, group[j].when)
        ) {
          hasOverlap = true;
          break;
        }
      }
      if (hasOverlap) break;
    }

    if (hasOverlap) {
      const osRes = isOsReserved(key);
      conflicts.push({
        key,
        actions: group.map((b) => b.action),
        overlappingContexts: true,
        osReserved: osRes !== null,
      });
    }
  }

  // Note: A chord "Alt-e ]" does NOT conflict with a direct binding on
  // "Alt-e" — CodeMirror's keymap system handles chord prefix matching
  // internally (the leader key is consumed only if a second stroke follows
  // within the timeout). No special filtering needed here because the key
  // strings are different ("Alt-e ]" !== "Alt-e").

  return conflicts;
}

// ---------------------------------------------------------------------------
// Free key generation
// ---------------------------------------------------------------------------

const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");
const DEFAULT_MODIFIERS = ["Mod", "Alt", "Mod-Shift", "Alt-Shift"];

function generateCandidateKeys(modifiers: string[]): string[] {
  const candidates: string[] = [];
  for (const mod of modifiers) {
    for (const letter of LETTERS) {
      candidates.push(`${mod}-${letter}`);
    }
  }
  return candidates;
}

// ---------------------------------------------------------------------------
// Resolver factory
// ---------------------------------------------------------------------------

export function createResolver(opts?: {
  defaults?: KeyBinding[];
  overrides?: Partial<Record<ActionId, string>>;
}): BindingResolver {
  const baseDefaults = opts?.defaults ?? defaultKeyBindings;
  const overrides = opts?.overrides ?? {};

  // Build the working binding list: apply overrides to defaults
  let bindings: KeyBinding[] = baseDefaults.map((binding) => {
    const override = overrides[binding.action];
    if (override !== undefined) {
      return { ...binding, key: override };
    }
    return { ...binding };
  });

  // Resolve all bindings into the full ResolvedBinding form.
  // When an action has multiple bindings (e.g. direct + chord alternative),
  // the map stores the FIRST (primary) binding. Use resolvedAll() for the
  // complete list including chord alternatives.
  function resolve(): Map<ActionId, ResolvedBinding> {
    const map = new Map<ActionId, ResolvedBinding>();
    for (const binding of bindings) {
      // Only store the first binding per action (primary binding)
      if (!map.has(binding.action)) {
        map.set(binding.action, {
          action: binding.action,
          key: binding.key,
          when: binding.when,
          preventDefault: binding.preventDefault ?? true,
          handler: getHandler(binding.action),
        });
      }
    }
    return map;
  }

  // Resolve ALL bindings including chord alternatives
  function resolveAll(): ResolvedBinding[] {
    return bindings.map((binding) => ({
      action: binding.action,
      key: binding.key,
      when: binding.when,
      preventDefault: binding.preventDefault ?? true,
      handler: getHandler(binding.action),
    }));
  }

  // Cache conflicts — recompute when bindings change
  let cachedConflicts: ConflictInfo[] | null = null;
  function getConflicts(): ConflictInfo[] {
    if (cachedConflicts === null) {
      cachedConflicts = detectConflicts(bindings);
    }
    return cachedConflicts;
  }

  function invalidateCache(): void {
    cachedConflicts = null;
  }

  // --- Public API ---

  const resolver: BindingResolver = {
    resolved: resolve,

    conflictsFor(key: string): ConflictInfo | null {
      return getConflicts().find((c) => c.key === key) ?? null;
    },

    allConflicts(): ConflictInfo[] {
      return getConflicts();
    },

    freeKeys(freeOpts?: { withModifiers?: string[] }): string[] {
      const modifiers = freeOpts?.withModifiers ?? DEFAULT_MODIFIERS;
      const candidates = generateCandidateKeys(modifiers);

      const boundKeys = new Set(bindings.map((b) => b.key));

      return candidates.filter((key) => {
        if (boundKeys.has(key)) return false;
        if (isBrowserReserved(key) !== null) return false;
        if (isOsReserved(key) !== null) return false;
        return true;
      });
    },

    rebind(action: ActionId, newKey: string): RebindResult {
      // Hard block: browser-reserved keys
      const browserRes = isBrowserReserved(newKey);
      if (browserRes !== null) {
        return { status: "blocked", reason: browserRes.reason };
      }

      // Find the binding being rebound
      const idx = bindings.findIndex((b) => b.action === action);
      if (idx === -1) {
        return { status: "blocked", reason: `Action "${action}" has no binding to rebind` };
      }

      const oldKey = bindings[idx].key;

      // Check for displacement: is newKey already bound?
      const displaced = bindings.find(
        (b) => b.key === newKey && b.action !== action && whenExpressionsOverlap(b.when, bindings[idx].when),
      );

      if (displaced) {
        // Ranked suggestions per keybindings.md §1.9:
        //   context-split (zero disruption) > swap > chord > nearby
        const suggestions: RebindSuggestion[] = [];

        // Suggestion 1: context-split — if the two actions' when-clauses can be
        // made non-overlapping, they could share the key with no displacement.
        // We can only offer this when at least one side already carries a
        // context predicate (otherwise there is nothing to split on).
        const incomingWhen = bindings[idx].when;
        if (incomingWhen !== undefined || displaced.when !== undefined) {
          suggestions.push({ type: "context-split", target: newKey });
        }

        // Suggestion 2: swap — move displaced action to the old key
        suggestions.push({ type: "swap", target: oldKey });

        // Suggestion 3: chord — move into a namespace under the leader of the
        // requested key (e.g. "Alt-e" → "Alt-e <free letter>").
        const chordTarget = suggestChordTarget(newKey, bindings);
        if (chordTarget) {
          suggestions.push({ type: "chord", target: chordTarget });
        }

        // Suggestion 4: nearby — find closest free key
        const free = resolver.freeKeys();
        if (free.length > 0) {
          suggestions.push({ type: "nearby", target: free[0] });
        }

        return {
          status: "conflict",
          displaced: displaced.action,
          suggestions,
        };
      }

      // No conflict — apply the rebind
      bindings = bindings.map((b) =>
        b.action === action ? { ...b, key: newKey } : b,
      );
      invalidateCache();

      // Check OS reservation as informational (the rebind still succeeds)
      // Callers can inspect isOsReserved(newKey) separately if they want warnings.

      return { status: "ok" };
    },

    toKeymapExtensions(): Extension[] {
      // Use resolveAll() to include chord alternatives — the resolved()
      // map only stores one binding per action (the primary).
      const allBindings = resolveAll();

      // Separate bindings by whether they have a when clause.
      // Bindings with when-clauses need higher precedence so they can
      // take priority over unconditional bindings on the same key.
      const conditionalCM: CMKeyBinding[] = [];
      const unconditionalCM: CMKeyBinding[] = [];

      for (const rb of allBindings) {
        if (!rb.handler) continue;

        // Skip analogOnly actions — they cannot be keyboard-triggered
        if (getAction(rb.action).analogOnly) continue;

        // Wrap the handler to record usage before delegating.
        // Handlers may be EditorHandler (takes view) or VoidHandler (no args).
        // Use .length to discriminate at runtime.
        const originalHandler = rb.handler;
        const actionId = rb.action;
        const when = rb.when;
        const invoke = (view: any) => {
          recordAction(actionId);
          announceAction(actionId);
          return originalHandler.length > 0
            ? (originalHandler as (v: any) => boolean)(view)
            : (originalHandler as () => boolean)();
        };

        if (when !== undefined) {
          // Context-sensitive binding (keybindings.md §1.7/§1.9,
          // input-dispatch.md §2.4): evaluate the when-clause at fire time.
          // When the context is not active, return false so CodeMirror falls
          // through to any lower-precedence binding on the same key (or to
          // default handling). The usage/announce side effects (in `invoke`)
          // only fire when the binding actually runs.
          const gatedRun = (view: any): boolean => {
            if (!evaluateWhen(when)) return false;
            return invoke(view);
          };
          // NB: preventDefault MUST be false here. CodeMirror merges every
          // binding on a key into one entry whose `preventDefault` flag is OR'd
          // and applied even when `run` returns false. With preventDefault:true
          // an inactive-context binding would still swallow the key, blocking
          // fall-through to lower-precedence bindings. When the context IS
          // active, `run` returns true → the event is treated as handled (and
          // prevented) regardless of this flag.
          conditionalCM.push({
            key: rb.key,
            run: gatedRun,
            preventDefault: false,
          });
        } else {
          unconditionalCM.push({
            key: rb.key,
            run: invoke,
            preventDefault: rb.preventDefault,
          });
        }
      }

      const extensions: Extension[] = [];

      // Conditional bindings get higher precedence so they can override
      // unconditional ones when their context is active.
      if (conditionalCM.length > 0) {
        extensions.push(Prec.high(keymap.of(conditionalCM)));
      }
      if (unconditionalCM.length > 0) {
        extensions.push(keymap.of(unconditionalCM));
      }

      return extensions;
    },
  };

  return resolver;
}
