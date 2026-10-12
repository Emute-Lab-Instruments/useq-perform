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
import { keymap, ViewPlugin } from "@codemirror/view";
import type { EditorView } from "@codemirror/view";
import { Compartment, Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { historyKeymap } from "@codemirror/commands";
import { createResolver } from "../lib/keybindings/resolver.ts";
import { getHandler } from "./commands/actionHandlers.ts";
import { bindingsForProfile } from "../lib/keybindings/profileRegistry.ts";
import { registerDefaultContexts } from "../lib/keybindings/contexts.ts";
import { stickyModifiersExtension } from "../lib/keybindings/stickyModifiers.ts";
import { setLiveBindingsProvider } from "../lib/keybindings/liveBindings.ts";
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

export function buildInitialResolver() {
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

  return createResolver({ defaults, overrides, getHandler });
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

// keybindings.md §1.14: the current third-party passthrough surface is audited.
// Warn only when an upgrade adds a binding we have not reviewed; the known set
// is intentional startup configuration, not an exceptional condition.
const auditedClojurePassthroughKeys = new Set([
  "Tab", "Alt-ArrowLeft", "Alt-ArrowUp", "Mod-1", "Mod-Shift-k",
  "Mod-Shift-j", "Alt-ArrowRight", "Alt-s", "Alt-ArrowDown", "Mod-2",
  "ArrowDown", "Mod-a", "End", "Home", "ArrowLeft", "Mod-End",
  "Mod-Backspace", "Mod-Delete", "PageDown", "PageUp", "Mod-u",
  "ArrowRight", "ArrowUp", "Mod-Home",
]);
const unrecognisedPassthroughKeys = remainingClojureBindings
  .map((binding: any) => binding.key)
  .filter(
    (key: unknown): key is string =>
      typeof key === "string" && !auditedClojurePassthroughKeys.has(key),
  );

if (unrecognisedPassthroughKeys.length > 0) {
  console.warn(
    `[keybindings] ${unrecognisedPassthroughKeys.length} clojure-mode binding(s) passed through ` +
      `without an action-registry wrapper (keybindings.md §1.14): ` +
      unrecognisedPassthroughKeys.join(", "),
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
      // A conditional registry binding on this policy key whose context is
      // active runs first (keybindings.md §1.7): e.g. Enter →
      // liveEdit.vectorConfirm while vectorMark.active (live-edit.md
      // §3.7.3/§3.7.8). Without this, the Prec.highest policy route below
      // would insert a newline instead of confirming the vector mark.
      if (resolver.runActiveConditionalBinding(key, view)) return true;
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
// Live keymap compartment — resolver rebinds must reach the running editors
// (keybindings.md §1.3/§1.9): the Keybindings panel and visualiser mutate the
// resolver via rebind(); the registry-generated keymap extension is rebuilt
// and swapped into every live view through this compartment.
// ---------------------------------------------------------------------------

const keymapCompartment = new Compartment();

function registryKeymapExtensions(): Extension[] {
  const extensions: Extension[] = [...resolver.toKeymapExtensions()];
  // Sticky modifiers (keybindings.md §1.12) ride with the keymap bundle so a
  // rebind-reconfigure preserves the gate. Boot-time read: the setting has no
  // live toggle surface today.
  if (getAppSettings().keybindings?.stickyModifiers === true) {
    extensions.push(stickyModifiersExtension());
  }
  return extensions;
}

// Publish the active bindings for UI readers (keybindings.md §2) through the
// lib-layer provider — a static resolver import from those modules would be a
// module-init cycle (keymaps → actionHandlers → ActionPalette → …).
setLiveBindingsProvider(() =>
  resolver.resolvedAll().map((rb) => ({
    action: rb.action,
    key: rb.key,
    when: rb.when,
    preventDefault: rb.preventDefault,
  })),
);

// Track live views so refreshKeymapExtensions() can reach every editor.
const liveViews = new Set<EditorView>();
const keymapViewTracker = ViewPlugin.fromClass(
  class {
    private view: EditorView;
    constructor(view: EditorView) {
      this.view = view;
      liveViews.add(view);
    }
    destroy() {
      liveViews.delete(this.view);
    }
  },
);

/**
 * Rebuild the registry keymap from the current resolver state and reconfigure
 * every live editor. Call after any successful `resolver.rebind()`.
 */
export function refreshKeymapExtensions(): void {
  for (const view of liveViews) {
    view.dispatch({ effects: keymapCompartment.reconfigure(registryKeymapExtensions()) });
  }
}

// ---------------------------------------------------------------------------
// Composed keymap extensions
// ---------------------------------------------------------------------------

export let baseKeymap = [
  // Highest precedence: policy keys route through the command router.
  Prec.highest(
    keymap.of([...policyKeys].map(policyKeyBinding)),
  ),

  keymapViewTracker,

  // Registry-generated bindings (our custom actions), behind a compartment so
  // resolver rebinds apply without a reload.
  keymapCompartment.of(registryKeymapExtensions()),

  // Remaining clojure-mode bindings (not remapped, not policy keys)
  keymap.of(remainingClojureBindings),

  // History (platform-specific undo/redo variants beyond Mod-z / Shift-Mod-z)
  keymap.of(historyKeymap),
];

export let mainEditorKeymap = [baseKeymap];
