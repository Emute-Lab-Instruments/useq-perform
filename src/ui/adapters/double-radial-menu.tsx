/**
 * Double radial menu adapter - imperative API.
 *
 * Uses createSolidAdapter for mount lifecycle.
 */
import { Show, createSignal } from "solid-js";
import { DoubleRadialPicker, type PickerCategory, type PickerEntry } from "../DoubleRadialPicker";
import { createSolidAdapter } from "./createSolidAdapter";

type OpenOptions = {
  categories: PickerCategory[];
  title?: string;
  onSelect?: (entry: PickerEntry) => void;
  onCancel?: () => void;
  menuSize?: number;
  innerRadiusRatio?: number;
  stickThreshold?: number;
};

const [isOpen, setIsOpen] = createSignal(false);
const [title, setTitle] = createSignal<string | undefined>(undefined);
const [categories, setCategories] = createSignal<PickerCategory[]>([]);
const [menuSize, setMenuSize] = createSignal<number | undefined>(undefined);
const [innerRatio, setInnerRatio] = createSignal<number | undefined>(undefined);
const [stickThreshold, setStickThreshold] = createSignal<number | undefined>(undefined);

let onSelectRef: ((entry: PickerEntry) => void) | null = null;
let onCancelRef: (() => void) | null = null;

function closeMenu(): void {
  setIsOpen(false);
}

/**
 * Open the double radial menu with the given options.
 * Returns a close function.
 */
export function open(opts: OpenOptions): () => void {
  setTitle(opts.title);
  setCategories(Array.isArray(opts.categories) ? opts.categories : []);
  setMenuSize(opts.menuSize);
  setInnerRatio(opts.innerRadiusRatio);
  setStickThreshold(opts.stickThreshold);

  onSelectRef = typeof opts.onSelect === "function" ? opts.onSelect : null;
  onCancelRef = typeof opts.onCancel === "function" ? opts.onCancel : null;

  setIsOpen(true);

  return closeMenu;
}

/**
 * Close the double radial menu.
 */
export function close(): void {
  closeMenu();
}

const adapter = createSolidAdapter({
  containerId: "double-radial-menu-root",
  containerStyle: {
    position: "fixed",
    inset: "0",
    zIndex: "1100",
    pointerEvents: "none",
  },
  Component: () => (
    <Show when={isOpen()}>
      <div style={{ "pointer-events": "auto" }}>
        <DoubleRadialPicker
          title={title()}
          categories={categories()}
          menuSize={menuSize()}
          innerRadiusRatio={innerRatio()}
          stickThreshold={stickThreshold()}
          onSelect={(entry) => {
            try {
              onSelectRef?.(entry);
            } finally {
              closeMenu();
            }
          }}
          onCancel={() => {
            try {
              onCancelRef?.();
            } finally {
              closeMenu();
            }
          }}
        />
      </div>
    </Show>
  ),
});

/**
 * Mount the double radial menu root element and render the component.
 * Safe to call multiple times; will only mount once.
 * In non-browser environments (e.g., Node.js tests), this is a no-op.
 */
export function mountDoubleRadialMenu(root?: HTMLElement): void {
  adapter.mount(root);
}
