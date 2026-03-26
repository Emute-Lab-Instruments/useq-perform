/**
 * Sticky Modifiers — accessibility feature.
 *
 * When enabled, modifier keys "stick" after a single press-release (without
 * any other key being pressed in between). The next non-modifier keypress is
 * treated as if the sticky modifier were held. Press the modifier again to
 * unstick it.
 *
 * Implementation strategy: a CodeMirror `domEventHandlers` extension intercepts
 * `keydown` events and synthesises modifier flags from the sticky state before
 * CodeMirror's keymap processing sees them. This avoids fragile re-dispatch of
 * native KeyboardEvents.
 *
 * Exports a SolidJS signal `stickyState()` so the keyboard visualiser (or any
 * other reactive consumer) can show which modifiers are currently stuck.
 */

import { createSignal } from "solid-js";
import { EditorView } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StickyState {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const EMPTY_STATE: StickyState = {
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};

// ---------------------------------------------------------------------------
// Reactive signal
// ---------------------------------------------------------------------------

const [stickyState, setStickyState] = createSignal<StickyState>({
  ...EMPTY_STATE,
});

export { stickyState };

// ---------------------------------------------------------------------------
// Modifier key detection
// ---------------------------------------------------------------------------

type ModifierName = keyof StickyState;

const MODIFIER_KEYS: Record<string, ModifierName> = {
  Control: "ctrl",
  Alt: "alt",
  Shift: "shift",
  Meta: "meta",
};

function isModifierKey(key: string): boolean {
  return key in MODIFIER_KEYS;
}

function modifierName(key: string): ModifierName | undefined {
  return MODIFIER_KEYS[key];
}

function hasAnyStickyModifier(state: StickyState): boolean {
  return state.ctrl || state.alt || state.shift || state.meta;
}

// ---------------------------------------------------------------------------
// Sticky modifier CodeMirror extension
// ---------------------------------------------------------------------------

/**
 * Returns a CodeMirror extension that implements sticky modifier behaviour.
 *
 * When a modifier key is pressed and released without any intervening
 * non-modifier keypress, it becomes "sticky". The next non-modifier keydown
 * is intercepted: a new KeyboardEvent is dispatched with the sticky modifier
 * flags applied, and the original event is consumed. The sticky state is then
 * cleared.
 *
 * Pressing a sticky modifier again toggles it off.
 */
export function stickyModifiersExtension(): Extension {
  // Track whether the last keydown was a lone modifier (no other key between
  // keydown and keyup). This is per-extension-instance state, not global,
  // so multiple editor instances each get independent tracking — but they all
  // share the same sticky signal (which is fine since only one editor is
  // active at a time).
  let pendingModifier: ModifierName | null = null;

  return EditorView.domEventHandlers({
    keydown(event: KeyboardEvent, view: EditorView) {
      const current = stickyState();

      // --- Modifier key pressed ---
      const mod = modifierName(event.key);
      if (mod) {
        // If this modifier is already sticky, unstick it (toggle off)
        if (current[mod]) {
          const next = { ...current, [mod]: false };
          setStickyState(next);
          pendingModifier = null;
          return false; // let the event pass through normally
        }

        // Start tracking this as a potential lone-modifier press
        pendingModifier = mod;
        return false;
      }

      // --- Non-modifier key pressed ---
      // Cancel any pending modifier — a non-modifier was pressed while the
      // modifier was held (normal combo), so don't make it sticky.
      pendingModifier = null;

      // If we have sticky state, synthesise a new event with modifier flags
      if (hasAnyStickyModifier(current)) {
        const syntheticEvent = new KeyboardEvent("keydown", {
          key: event.key,
          code: event.code,
          keyCode: event.keyCode,
          which: event.which,
          ctrlKey: event.ctrlKey || current.ctrl,
          altKey: event.altKey || current.alt,
          shiftKey: event.shiftKey || current.shift,
          metaKey: event.metaKey || current.meta,
          repeat: event.repeat,
          bubbles: true,
          cancelable: true,
          composed: true,
        });

        // Clear sticky state before dispatching to avoid infinite loop
        setStickyState({ ...EMPTY_STATE });

        // Prevent the original event from being processed
        event.preventDefault();
        event.stopPropagation();

        // Dispatch the synthetic event on the editor's DOM element.
        // CodeMirror will pick this up and process it through its keymap.
        view.contentDOM.dispatchEvent(syntheticEvent);

        return true; // consumed the original event
      }

      return false;
    },

    keyup(event: KeyboardEvent) {
      const mod = modifierName(event.key);
      if (mod && pendingModifier === mod) {
        // The modifier was pressed and released without any other key —
        // make it sticky.
        const current = stickyState();
        setStickyState({ ...current, [mod]: true });
        pendingModifier = null;
      }
      return false;
    },
  });
}

// ---------------------------------------------------------------------------
// Global (non-editor) sticky modifier listener
// ---------------------------------------------------------------------------

/**
 * Initialise window-level sticky modifier tracking for contexts outside
 * CodeMirror (e.g. when focus is on a panel or toolbar). Returns a cleanup
 * function that removes the listeners.
 *
 * The CodeMirror extension handles editor-focused scenarios; this covers the
 * rest of the page.
 */
export function initStickyModifiers(): () => void {
  let pendingModifier: ModifierName | null = null;

  function onKeyDown(event: KeyboardEvent) {
    // Skip events that originated inside a CodeMirror editor — those are
    // handled by the extension.
    if ((event.target as Element)?.closest?.(".cm-editor")) return;

    const current = stickyState();
    const mod = modifierName(event.key);

    if (mod) {
      if (current[mod]) {
        setStickyState({ ...current, [mod]: false });
        pendingModifier = null;
        return;
      }
      pendingModifier = mod;
      return;
    }

    // Non-modifier pressed
    pendingModifier = null;

    if (hasAnyStickyModifier(current)) {
      // Clear sticky state. Unlike the editor extension, we don't need to
      // synthesise events here — non-editor key handlers don't go through
      // CodeMirror's keymap. The consuming code can check stickyState()
      // reactively or we leave it to per-handler logic.
      setStickyState({ ...EMPTY_STATE });
    }
  }

  function onKeyUp(event: KeyboardEvent) {
    if ((event.target as Element)?.closest?.(".cm-editor")) return;

    const mod = modifierName(event.key);
    if (mod && pendingModifier === mod) {
      const current = stickyState();
      setStickyState({ ...current, [mod]: true });
      pendingModifier = null;
    }
  }

  window.addEventListener("keydown", onKeyDown, true);
  window.addEventListener("keyup", onKeyUp, true);

  return () => {
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("keyup", onKeyUp, true);
  };
}

/**
 * Clear all sticky modifier state. Useful when focus changes or a modal opens.
 */
export function clearStickyState(): void {
  setStickyState({ ...EMPTY_STATE });
}
