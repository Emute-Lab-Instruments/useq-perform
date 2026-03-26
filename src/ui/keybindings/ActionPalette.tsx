/**
 * ActionPalette — fuzzy-searchable command runner.
 *
 * Opens as a floating overlay, lists all registered actions with their current
 * keybinding, and executes the selected action. Keyboard-navigable with
 * arrow keys, Enter, and Escape.
 */

import {
  createSignal,
  createMemo,
  For,
  Show,
  onMount,
  onCleanup,
  type Component,
} from "solid-js";
import { actions, type ActionId, type ActionDef } from "../../lib/keybindings/actions.ts";
import { defaultKeyBindings } from "../../lib/keybindings/defaults.ts";
import { getHandler } from "../../lib/keybindings/handlers.ts";
import { editor } from "../../lib/editorStore.ts";
import { pushOverlay } from "../overlayManager.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a lookup from ActionId to its default key string. */
function buildKeyLookup(): Map<string, string> {
  const map = new Map<string, string>();
  for (const binding of defaultKeyBindings) {
    if (!map.has(binding.action)) {
      map.set(binding.action, binding.key);
    }
  }
  return map;
}

const keyLookup = buildKeyLookup();

/** Format a CodeMirror key string for display (e.g. "Mod-Shift-p" -> "Ctrl+Shift+P"). */
function formatKey(key: string): string {
  const isMac =
    typeof navigator !== "undefined" && /Mac|iPod|iPhone|iPad/.test(navigator.platform ?? "");
  return key
    .replace(/Mod/g, isMac ? "Cmd" : "Ctrl")
    .replace(/-/g, "+")
    .replace(/\b[a-z]\b/g, (c) => c.toUpperCase());
}

/** Simple case-insensitive substring match on multiple fields. */
function matchesQuery(
  query: string,
  actionId: string,
  def: ActionDef,
): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  return (
    actionId.toLowerCase().includes(q) ||
    def.description.toLowerCase().includes(q) ||
    def.category.toLowerCase().includes(q)
  );
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

let toastTimer: ReturnType<typeof setTimeout> | undefined;

function showToast(message: string): void {
  const existing = document.querySelector(".action-palette-toast");
  if (existing) existing.remove();
  if (toastTimer) clearTimeout(toastTimer);

  const el = document.createElement("div");
  el.className = "action-palette-toast";
  el.textContent = message;
  document.body.appendChild(el);

  toastTimer = setTimeout(() => {
    el.remove();
    toastTimer = undefined;
  }, 2000);
}

// ---------------------------------------------------------------------------
// Palette visibility signal (module-level so adapter can control it)
// ---------------------------------------------------------------------------

const [paletteVisible, setPaletteVisible] = createSignal(false);

export function openPalette(): void {
  setPaletteVisible(true);
}

export function closePalette(): void {
  setPaletteVisible(false);
}

// ---------------------------------------------------------------------------
// Action data
// ---------------------------------------------------------------------------

type ActionEntry = { id: ActionId; def: ActionDef };

/** Sorted list of all actions (excluding analog-only). */
const allActions: ActionEntry[] = (
  Object.entries(actions) as [ActionId, ActionDef][]
)
  .filter(([, def]) => !def.analogOnly)
  .sort((a, b) => {
    const cat = a[1].category.localeCompare(b[1].category);
    if (cat !== 0) return cat;
    return a[1].description.localeCompare(b[1].description);
  })
  .map(([id, def]) => ({ id, def }));

// ---------------------------------------------------------------------------
// Inner component (mounted/unmounted by Show, gets fresh lifecycle each time)
// ---------------------------------------------------------------------------

const PaletteInner: Component = () => {
  const [query, setQuery] = createSignal("");
  const [activeIndex, setActiveIndex] = createSignal(0);
  let inputRef: HTMLInputElement | undefined;
  let listRef: HTMLDivElement | undefined;

  const filtered = createMemo(() => {
    const q = query();
    return allActions.filter((entry) => matchesQuery(q, entry.id, entry.def));
  });

  const clampedIndex = createMemo(() => {
    const idx = activeIndex();
    const len = filtered().length;
    if (len === 0) return 0;
    return Math.min(idx, len - 1);
  });

  function scrollActiveIntoView(): void {
    if (!listRef) return;
    const child = listRef.children[clampedIndex()] as HTMLElement | undefined;
    child?.scrollIntoView({ block: "nearest" });
  }

  function executeAction(entry: ActionEntry): void {
    const handler = getHandler(entry.id);
    if (handler) {
      const view = editor();
      if (entry.def.requiresEditor && view) {
        (handler as (v: any) => boolean)(view);
      } else if (!entry.def.requiresEditor) {
        (handler as () => boolean)();
      }
    }

    closePalette();

    const keyStr = keyLookup.get(entry.id);
    if (keyStr) {
      showToast(`Tip: ${formatKey(keyStr)}`);
    }
  }

  function handleKeyDown(e: KeyboardEvent): void {
    const list = filtered();
    const len = list.length;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((clampedIndex() + 1) % Math.max(len, 1));
        scrollActiveIntoView();
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((clampedIndex() - 1 + Math.max(len, 1)) % Math.max(len, 1));
        scrollActiveIntoView();
        break;
      case "Enter":
        e.preventDefault();
        if (len > 0) {
          executeAction(list[clampedIndex()]);
        }
        break;
      // Escape is handled by the overlay manager
    }
  }

  function handleBackdropClick(e: MouseEvent): void {
    if (e.target === e.currentTarget) {
      closePalette();
    }
  }

  // Register overlay on mount, clean up on unmount
  let popOverlay: (() => void) | undefined;

  onMount(() => {
    popOverlay = pushOverlay("action-palette", closePalette);
    requestAnimationFrame(() => {
      inputRef?.focus();
    });
  });

  onCleanup(() => {
    popOverlay?.();
  });

  return (
    <div class="action-palette-backdrop" onClick={handleBackdropClick}>
      <div class="action-palette" onKeyDown={handleKeyDown}>
        <div class="action-palette-input-wrap">
          <input
            ref={inputRef}
            class="action-palette-input"
            type="text"
            placeholder="Type to search actions..."
            value={query()}
            onInput={(e) => {
              setQuery(e.currentTarget.value);
              setActiveIndex(0);
            }}
          />
        </div>

        <div class="action-palette-list" ref={listRef}>
          <Show
            when={filtered().length > 0}
            fallback={<div class="action-palette-empty">No matching actions</div>}
          >
            <For each={filtered()}>
              {(entry, i) => {
                const keyStr = keyLookup.get(entry.id);
                return (
                  <div
                    class="action-palette-item"
                    data-active={i() === clampedIndex() ? "true" : undefined}
                    onClick={() => executeAction(entry)}
                    onMouseEnter={() => setActiveIndex(i())}
                  >
                    <span class="action-palette-desc">{entry.def.description}</span>
                    <span class="action-palette-category">{entry.def.category}</span>
                    <Show when={keyStr}>
                      <span class="action-palette-key">{formatKey(keyStr!)}</span>
                    </Show>
                  </div>
                );
              }}
            </For>
          </Show>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Outer component (always mounted, controls visibility via Show)
// ---------------------------------------------------------------------------

export const ActionPalette: Component = () => {
  return (
    <Show when={paletteVisible()}>
      <PaletteInner />
    </Show>
  );
};
