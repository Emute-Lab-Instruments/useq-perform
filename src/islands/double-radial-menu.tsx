import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import { DoubleRadialPicker, type PickerCategory, type PickerEntry } from "../ui/DoubleRadialPicker";

type OpenOptions = {
  categories: PickerCategory[];
  title?: string;
  onSelect?: (entry: PickerEntry) => void;
  onCancel?: () => void;
  menuSize?: number;
  innerRadiusRatio?: number;
  stickThreshold?: number;
};

type API = {
  open: (opts: OpenOptions) => () => void;
  close: () => void;
};


function ensureRootElement() {
  const existing = document.getElementById("double-radial-menu-root");
  if (existing) return existing;

  const el = document.createElement("div");
  el.id = "double-radial-menu-root";
  // Keep it above existing overlays.
  el.style.position = "fixed";
  el.style.inset = "0";
  el.style.zIndex = "1100";
  el.style.pointerEvents = "none";

  document.body.appendChild(el);
  return el;
}

const [isOpen, setIsOpen] = createSignal(false);
const [title, setTitle] = createSignal<string | undefined>(undefined);
const [categories, setCategories] = createSignal<PickerCategory[]>([]);
const [menuSize, setMenuSize] = createSignal<number | undefined>(undefined);
const [innerRatio, setInnerRatio] = createSignal<number | undefined>(undefined);
const [stickThreshold, setStickThreshold] = createSignal<number | undefined>(undefined);

let onSelectRef: ((entry: PickerEntry) => void) | null = null;
let onCancelRef: (() => void) | null = null;

let prevBodyOverflow: string | null = null;

function lockScroll() {
  if (prevBodyOverflow !== null) return;
  prevBodyOverflow = document.body.style.overflow;
  document.body.style.overflow = "hidden";
}

function unlockScroll() {
  if (prevBodyOverflow === null) return;
  document.body.style.overflow = prevBodyOverflow;
  prevBodyOverflow = null;
}

function close() {
  setIsOpen(false);
  unlockScroll();
}

function open(opts: OpenOptions) {
  setTitle(opts.title);
  setCategories(Array.isArray(opts.categories) ? opts.categories : []);
  setMenuSize(opts.menuSize);
  setInnerRatio(opts.innerRadiusRatio);
  setStickThreshold(opts.stickThreshold);

  onSelectRef = typeof opts.onSelect === "function" ? opts.onSelect : null;
  onCancelRef = typeof opts.onCancel === "function" ? opts.onCancel : null;

  lockScroll();
  setIsOpen(true);

  return () => close();
}

export { open, close };

export function mountDoubleRadialMenu(root?: HTMLElement) {
  const el = root || ensureRootElement();
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
                close();
              }
            }}
            onCancel={() => {
              try {
                onCancelRef?.();
              } finally {
                close();
              }
            }}
          />
        </div>
      </Show>
    ),
    el
  );
}

// Auto-mount for backward compatibility (islands are still loaded as separate scripts)
mountDoubleRadialMenu();
