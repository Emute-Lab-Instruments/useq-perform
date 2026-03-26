/**
 * ModifierHints — ephemeral overlay showing available completions when a
 * modifier key is held for a configurable delay.
 *
 * Renders as a floating panel near the editor cursor (or screen-centered
 * when no cursor position is available). The overlay uses `pointer-events: none`
 * so it never steals focus or intercepts clicks.
 *
 * Mount once at bootstrap via `mountModifierHints()` — the component manages
 * its own visibility based on keyboard events.
 */

import {
  createSignal,
  createEffect,
  onCleanup,
  Show,
  For,
  type JSX,
} from "solid-js";
import { defaultKeyBindings } from "../../lib/keybindings/defaults.ts";
import { actions, type ActionId } from "../../lib/keybindings/actions.ts";
import { settings } from "../../utils/settingsStore.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface HintEntry {
  key: string;
  description: string;
  isChord: boolean;
}

// Map from `event.key` to the modifier prefix used in CodeMirror key notation.
const MODIFIER_KEYS: Record<string, string> = {
  Control: "Ctrl",
  Alt: "Alt",
  Meta: "Meta",
  Shift: "Shift",
};

// Display-friendly labels for the overlay header.
const MODIFIER_LABELS: Record<string, string> = {
  Ctrl: "Ctrl",
  Alt: "Alt",
  Meta: "Cmd",
  Shift: "Shift",
};

// CodeMirror uses "Mod" as an alias for Ctrl (non-Mac) / Meta (Mac).
const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// ---------------------------------------------------------------------------
// Hint content builder
// ---------------------------------------------------------------------------

/**
 * Build the list of available completions for a given modifier prefix.
 * Filters to direct (non-context-scoped) bindings and deduplicates chord
 * namespaces so each leader key appears once with a `->` indicator.
 */
function getHintsForModifier(modifier: string): HintEntry[] {
  // Collect all prefixes that match. "Ctrl" also matches "Mod" on the
  // appropriate platform.
  const prefixes = [modifier + "-"];
  if (modifier === "Ctrl" && !isMac) prefixes.push("Mod-");
  if (modifier === "Meta" && isMac) prefixes.push("Mod-");

  const seen = new Set<string>();
  const entries: HintEntry[] = [];

  for (const binding of defaultKeyBindings) {
    // Skip context-gated bindings (picker, bracket protect, etc.)
    if (binding.when) continue;

    const matchedPrefix = prefixes.find((p) => binding.key.startsWith(p));
    if (!matchedPrefix) continue;

    const remainder = binding.key.slice(matchedPrefix.length);
    if (!remainder) continue;

    const isChord = remainder.includes(" ");
    const displayKey = isChord ? remainder.split(" ")[0] : remainder;

    // Deduplicate: for chords, only show the leader once.
    const dedupeKey = isChord ? `chord:${displayKey}` : `key:${displayKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const action = actions[binding.action as ActionId];
    const description = isChord
      ? describeChordNamespace(displayKey, matchedPrefix)
      : action?.description ?? binding.action;

    entries.push({ key: displayKey, description, isChord });
  }

  // Sort: direct bindings first, then chords; alphabetical within each group.
  entries.sort((a, b) => {
    if (a.isChord !== b.isChord) return a.isChord ? 1 : -1;
    return a.key.localeCompare(b.key);
  });

  return entries;
}

/**
 * Build a short label for a chord namespace by inspecting what actions live
 * under it (e.g. "Structure..." or "Observe...").
 */
function describeChordNamespace(
  leaderKey: string,
  prefix: string,
): string {
  const full = prefix + leaderKey + " ";
  const childActions = defaultKeyBindings
    .filter((b) => b.key.startsWith(full) && !b.when)
    .map((b) => actions[b.action as ActionId]?.category)
    .filter(Boolean);

  // Pick the dominant category label.
  const cats = [...new Set(childActions)];
  if (cats.length === 1) {
    const labels: Record<string, string> = {
      structure: "Structure",
      probe: "Observe",
      editor: "Edit",
      navigation: "Navigate",
      ui: "UI",
      core: "Core",
    };
    return (labels[cats[0]] ?? cats[0]) + "...";
  }
  return "More...";
}

// ---------------------------------------------------------------------------
// Cursor position helper
// ---------------------------------------------------------------------------

function getEditorCursorPosition(): { x: number; y: number } | null {
  const editor = document.querySelector(".cm-editor");
  if (!editor) return null;

  const cursor = editor.querySelector(".cm-cursor-primary, .cm-cursor");
  if (cursor) {
    const rect = cursor.getBoundingClientRect();
    return { x: rect.left, y: rect.bottom + 4 };
  }

  // Fallback: use editor center.
  const editorRect = editor.getBoundingClientRect();
  return {
    x: editorRect.left + editorRect.width / 2,
    y: editorRect.top + editorRect.height * 0.3,
  };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function ModifierHints(): JSX.Element {
  const [heldModifier, setHeldModifier] = createSignal<string | null>(null);
  const [visible, setVisible] = createSignal(false);
  const [position, setPosition] = createSignal<{
    x: number;
    y: number;
  } | null>(null);

  let holdTimer: number | null = null;

  function getDelay(): number {
    return settings.keybindings?.modifierHintDelay ?? 500;
  }

  function clearHold(): void {
    if (holdTimer !== null) {
      clearTimeout(holdTimer);
      holdTimer = null;
    }
    setHeldModifier(null);
    setVisible(false);
  }

  function onKeyDown(e: KeyboardEvent): void {
    const modPrefix = MODIFIER_KEYS[e.key];

    if (modPrefix) {
      // A modifier key was pressed. Only start the timer if no other
      // modifier is currently held and this is a lone modifier press.
      if (heldModifier() === null) {
        const delay = getDelay();
        // Delay of 0 means disabled.
        if (delay <= 0) return;

        setHeldModifier(modPrefix);
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          // Verify the modifier is still held (no other key pressed).
          if (heldModifier() === modPrefix) {
            setPosition(getEditorCursorPosition());
            setVisible(true);
          }
        }, delay);
      }
    } else {
      // A non-modifier key was pressed — user is executing a combo.
      clearHold();
    }
  }

  function onKeyUp(e: KeyboardEvent): void {
    const modPrefix = MODIFIER_KEYS[e.key];
    if (modPrefix && heldModifier() === modPrefix) {
      clearHold();
    }
  }

  // Window blur also clears (user switched away).
  function onBlur(): void {
    clearHold();
  }

  // Register global listeners.
  if (typeof window !== "undefined") {
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", onBlur);

    onCleanup(() => {
      clearHold();
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", onBlur);
    });
  }

  // Build hints reactively based on held modifier.
  const hints = () => {
    const mod = heldModifier();
    if (!mod) return [];
    return getHintsForModifier(mod);
  };

  const displayLabel = () => {
    const mod = heldModifier();
    if (!mod) return "";
    return MODIFIER_LABELS[mod] ?? mod;
  };

  // Compute inline position styles. Clamp to viewport.
  const positionStyle = (): JSX.CSSProperties => {
    const pos = position();
    if (!pos) {
      // Center horizontally, upper third vertically.
      return {
        left: "50%",
        top: "25vh",
        transform: "translateX(-50%)",
      };
    }

    // Clamp so the overlay stays within the viewport.
    const x = Math.min(pos.x, window.innerWidth - 280);
    const y = Math.min(pos.y, window.innerHeight - 200);

    return {
      left: `${Math.max(8, x)}px`,
      top: `${Math.max(8, y)}px`,
    };
  };

  return (
    <Show when={visible() && hints().length > 0}>
      <div class="modifier-hints" style={positionStyle()}>
        <div class="modifier-hints-header">
          {displayLabel()} + ...
        </div>
        <div class="modifier-hints-list">
          <For each={hints()}>
            {(entry) => (
              <div class="modifier-hints-row">
                <span class="modifier-hints-key">
                  {entry.key}
                  {entry.isChord && (
                    <span class="modifier-hints-chord-arrow">{"\u2192"}</span>
                  )}
                </span>
                <span class="modifier-hints-desc">{entry.description}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
  );
}
