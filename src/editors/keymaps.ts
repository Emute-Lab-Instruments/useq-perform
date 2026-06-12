/**
 * Keymap generation — driven by the action registry's binding resolver.
 *
 * The resolver (from src/lib/keybindings/) owns all custom bindings (eval,
 * panel toggles, probes, structural editing remaps, undo/redo).
 * This module composes those with the remaining clojure-mode bindings that the
 * resolver does NOT manage, plus the CodeMirror history keymap.
 *
 * Policy-sensitive keys (Backspace, Delete, Enter, brackets) route through the
 * command router — see docs/specs/input-dispatch.md.
 */

import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import { keymap } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { historyKeymap } from "@codemirror/commands";
import { createResolver } from "../lib/keybindings/resolver.ts";
import { bindingsForProfile } from "../lib/keybindings/profileRegistry.ts";
import { registerDefaultContexts } from "../lib/keybindings/contexts.ts";
import { profileFromUrl } from "../lib/keybindings/profiles.ts";
import { actions, type ActionId } from "../lib/keybindings/actions.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { executeEditorCommand } from "./commands/editorCommandRouter.ts";

// ---------------------------------------------------------------------------
// Context predicates — register the DOM-based defaults so when-clauses on
// conditional bindings (keybindings.md §1.7) can actually be evaluated.
// Other modules register their own predicates during their init.
// ---------------------------------------------------------------------------

registerDefaultContexts();

// ---------------------------------------------------------------------------
// Resolver instance — built from the active profile + user overrides
// (keybindings.md §1.3) and exported so other modules can query/rebind.
//
// Precedence of overrides (lowest → highest):
//   profile defaults  ⊕  persisted user overrides  ⊕  ?keymap= URL overrides
// ---------------------------------------------------------------------------

function buildInitialResolver() {
  const kb = getAppSettings().keybindings;

  // ?keymap=base64... URL profile import (keybindings.md §1.13, url-params.md §2).
  // Read independently of the main startupFlags parser. If present it selects
  // the base profile and contributes the highest-priority overrides.
  const imported =
    typeof window !== "undefined" ? profileFromUrl(window.location.href) : { ok: false as const };

  const profileId = imported.ok ? imported.profile.baseProfile : kb?.profile;
  const defaults = bindingsForProfile(profileId);

  const overrides: Partial<Record<ActionId, string>> = {};
  // Persisted user overrides (lower priority)
  for (const [action, key] of Object.entries(kb?.overrides ?? {})) {
    if (action in actions && typeof key === "string") {
      overrides[action as ActionId] = key;
    }
  }
  // URL-imported overrides win over persisted ones for the keys they specify.
  if (imported.ok) {
    for (const [action, key] of Object.entries(imported.profile.overrides)) {
      if (action in actions && typeof key === "string") {
        overrides[action as ActionId] = key;
      }
    }
  }

  return createResolver({ defaults, overrides });
}

export const resolver = buildInitialResolver();

// ---------------------------------------------------------------------------
// Policy keys — routed through the command router (input-dispatch.md §3.3).
// These must not appear in remainingClojureBindings or any other keymap
// at default precedence — the router owns their policy enforcement.
// ---------------------------------------------------------------------------

const policyKeys = new Set([
  "Backspace",
  "Delete",
  "Enter",
  "(",
  ")",
  "[",
  "]",
  "{",
  "}",
  "\"",
]);

// ---------------------------------------------------------------------------
// Clojure-mode passthrough
//
// The resolver already handles the 4 arrow→bracket remaps (slurp/barf)
// and kill-to-end-of-list.  Policy keys are handled by the command router.
// Filter both sets out, then pass the rest through (indentation, nav, etc.).
// ---------------------------------------------------------------------------

const remappedKeys = new Set([
  "Ctrl-ArrowRight",
  "Ctrl-ArrowLeft",
  "Ctrl-Alt-ArrowLeft",
  "Ctrl-Alt-ArrowRight",
  "Ctrl-k",
]);

const remainingClojureBindings = completeClojureKeymap
  .filter((b: any) => !remappedKeys.has(b.key) && !policyKeys.has(b.key));

// keybindings.md §1.14: third-party (`@nextjournal/clojure-mode`) bindings that
// are not wrapped in the action registry are passed through unmodified, with a
// one-time startup warning logged for the unrecognised keys so the set is
// auditable rather than silent.
if (remainingClojureBindings.length > 0) {
  const passthroughKeys = remainingClojureBindings
    .map((b: any) => b.key)
    .filter((k: unknown): k is string => typeof k === "string");
  console.warn(
    `[keybindings] ${passthroughKeys.length} clojure-mode binding(s) passed through ` +
      `without an action-registry wrapper (keybindings.md §1.14): ` +
      passthroughKeys.join(", "),
  );
}

// ---------------------------------------------------------------------------
// Policy key dispatcher — Prec.highest so it intercepts before any
// clojure-mode extension or third-party keymap.
// ---------------------------------------------------------------------------

function policyKeyBinding(key: string) {
  return {
    key,
    run: (view: EditorView) => {
      const prevent =
        getAppSettings().editor?.preventBracketUnbalancing ?? true;
      return executeEditorCommand(view, {
        kind: "key",
        key,
        allowBracketUnbalancing: !prevent,
        source: "keyboard",
      });
    },
  };
}

// ---------------------------------------------------------------------------
// Composed keymap extensions
// ---------------------------------------------------------------------------

export let baseKeymap = [
  // Highest precedence: policy keys route through the command router.
  Prec.highest(
    keymap.of([...policyKeys].map(policyKeyBinding)),
  ),

  // Registry-generated bindings (our custom actions)
  ...resolver.toKeymapExtensions(),

  // Remaining clojure-mode bindings (not remapped, not policy keys)
  keymap.of(remainingClojureBindings),

  // History (platform-specific undo/redo variants beyond Mod-z / Shift-Mod-z)
  keymap.of(historyKeymap),
];

export let mainEditorKeymap = [baseKeymap];
