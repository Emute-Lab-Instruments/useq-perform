/**
 * Double radial menu adapter - imperative API without island dependency.
 *
 * This module provides the same API as the islands/double-radial-menu.tsx island but
 * can be imported directly without requiring a separate script tag.
 */
import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { DoubleRadialPicker, type PickerCategory, type PickerEntry } from "../DoubleRadialPicker";

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

function ensureDoubleRadialRoot(): HTMLElement {
  const existing = document.getElementById("double-radial-menu-root");
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = "double-radial-menu-root";
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "1100";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  return el;
}

let mounted = false;

/**
 * Check if we're in a browser environment.
 */
function isBrowser(): boolean {
  return typeof document !== "undefined" && typeof window !== "undefined";
}

/**
 * Mount the double radial menu root element and render the component.
 * Safe to call multiple times; will only mount once.
 * In non-browser environments (e.g., Node.js tests), this is a no-op.
 */
export function mountDoubleRadialMenu(root?: HTMLElement): void {
  if (mounted) return;
  if (!isBrowser()) return;
  mounted = true;

  const el = root || ensureDoubleRadialRoot();
  render(
    () => (
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
    el,
  );
}
