/**
 * Picker menu adapter - imperative picker menu API.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { Show, createSignal, type Component } from "solid-js";
import {
  PickerMenu,
  NumberPickerMenu,
  type PickerMenuItem,
  type PickerMenuProps,
  type NumberPickerMenuProps,
} from "../PickerMenu";
import { createSolidAdapter } from "./createSolidAdapter";

/**
 * Icons available in picker menus. Populated lazily at mount time via dynamic import
 * so this module remains safe to import in Node.js/mocha test environments.
 * Add new lucide-solid imports in initIcons() below when new icons are needed.
 */
const iconRegistry: Record<string, Component> = {};

async function initIcons(): Promise<void> {
  try {
    const { Calculator, Clock, ArrowLeftRight, Wrench } = await import("lucide-solid");
    Object.assign(iconRegistry, {
      calculator: Calculator,
      clock: Clock,
      "arrow-left-right": ArrowLeftRight,
      wrench: Wrench,
    });
  } catch {
    // Non-browser or missing package — icons degrade gracefully (labels remain visible)
  }
}
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

const adapter = createSolidAdapter({
  containerId: "picker-menu-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "1000",
    pointerEvents: "none",
  },
  onMount: () => {
    // Fire-and-forget: resolves long before first user interaction opens a picker
    void initIcons();
  },
  Component: () => (
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
                iconRegistry={iconRegistry}
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
});

/**
 * Mount the picker root element and render the picker component.
 * Safe to call multiple times; will only mount once.
 * In non-browser environments (e.g., Node.js tests), this is a no-op.
 */
export function mountPickerMenu(root?: HTMLElement): void {
  adapter.mount(root);
}
