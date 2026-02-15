/**
 * Picker menu adapter - imperative picker menu API without island dependency.
 *
 * This module provides the same API as the islands/picker-menu.tsx island but
 * can be imported directly without requiring a separate script tag.
 */
import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import {
  PickerMenu,
  NumberPickerMenu,
  type PickerMenuItem,
  type PickerMenuProps,
  type NumberPickerMenuProps,
} from "../PickerMenu";
import {
  HierarchicalPickerMenu,
  type HierarchicalCategory,
  type HierarchicalItem,
} from "../HierarchicalPickerMenu";

type MenuState =
  | { kind: "closed" }
  | { kind: "picker"; opts: PickerMenuProps }
  | { kind: "number"; opts: NumberPickerMenuProps }
  | {
      kind: "hierarchical";
      categories: HierarchicalCategory[];
      title?: string;
      onSelect: (item: HierarchicalItem) => void;
    };

const [menuState, setMenuState] = createSignal<MenuState>({ kind: "closed" });

function ensurePickerRoot(): HTMLElement {
  const existing = document.getElementById("picker-menu-root");
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = "picker-menu-root";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "1000";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  return el;
}

function closeMenu(): void {
  setMenuState({ kind: "closed" });
}

/**
 * Show a picker menu with the given items.
 * Returns a close function.
 */
export function showPickerMenu(opts: {
  items: PickerMenuItem[];
  onSelect: (item: PickerMenuItem, index: number) => void;
  title?: string;
  layout?: "grid" | "vertical";
  initialIndex?: number;
}): () => void {
  if (!Array.isArray(opts.items) || opts.items.length === 0) return () => {};
  setMenuState({
    kind: "picker",
    opts: {
      items: opts.items,
      onSelect: opts.onSelect,
      onClose: closeMenu,
      title: opts.title,
      layout: opts.layout,
      initialIndex: opts.initialIndex,
    },
  });
  return closeMenu;
}

/**
 * Show a number picker menu.
 * Returns a close function.
 */
export function showNumberPickerMenu(opts: {
  onSelect: (value: number) => void;
  title?: string;
  initialValue?: number;
  min?: number;
  max?: number;
  step?: number;
}): () => void {
  setMenuState({
    kind: "number",
    opts: {
      onSelect: opts.onSelect,
      onClose: closeMenu,
      title: opts.title,
      initialValue: opts.initialValue,
      min: opts.min,
      max: opts.max,
      step: opts.step,
    },
  });
  return closeMenu;
}

/**
 * Show a hierarchical grid picker.
 * Returns a close function.
 */
export function showHierarchicalGridPicker(opts: {
  categories: HierarchicalCategory[];
  title?: string;
  onSelect: (item: HierarchicalItem) => void;
}): () => void {
  if (!Array.isArray(opts.categories) || opts.categories.length === 0)
    return () => {};
  setMenuState({
    kind: "hierarchical",
    categories: opts.categories,
    title: opts.title,
    onSelect: opts.onSelect,
  });
  return closeMenu;
}

/**
 * Close any open picker menu.
 */
export function close(): void {
  closeMenu();
}

let mounted = false;

/**
 * Check if we're in a browser environment.
 */
function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

/**
 * Mount the picker root element and render the picker component.
 * Safe to call multiple times; will only mount once.
 * In non-browser environments (e.g., Node.js tests), this is a no-op.
 */
export function mountPickerMenu(root?: HTMLElement): void {
  if (mounted) return;
  if (!isBrowser()) return;
  mounted = true;

  const el = root || ensurePickerRoot();
  render(
    () => (
      <Show when={menuState().kind !== "closed"}>
        <div style={{ "pointer-events": "auto" }}>
          <Show when={menuState().kind === "picker" ? menuState() : false}>
            {(s) => {
              const st = s() as Extract<MenuState, { kind: "picker" }>;
              return (
                <PickerMenu
                  items={st.opts.items}
                  onSelect={st.opts.onSelect}
                  onClose={closeMenu}
                  title={st.opts.title}
                  layout={st.opts.layout}
                  initialIndex={st.opts.initialIndex}
                />
              );
            }}
          </Show>
          <Show when={menuState().kind === "number" ? menuState() : false}>
            {(s) => {
              const st = s() as Extract<MenuState, { kind: "number" }>;
              return (
                <NumberPickerMenu
                  onSelect={st.opts.onSelect}
                  onClose={closeMenu}
                  title={st.opts.title}
                  initialValue={st.opts.initialValue}
                  min={st.opts.min}
                  max={st.opts.max}
                  step={st.opts.step}
                />
              );
            }}
          </Show>
          <Show when={menuState().kind === "hierarchical" ? menuState() : false}>
            {(s) => {
              const st = s() as Extract<MenuState, { kind: "hierarchical" }>;
              return (
                <HierarchicalPickerMenu
                  categories={st.categories}
                  title={st.title}
                  onSelect={(item) => {
                    st.onSelect(item);
                    closeMenu();
                  }}
                  onClose={closeMenu}
                />
              );
            }}
          </Show>
        </div>
      </Show>
    ),
    el,
  );
}
