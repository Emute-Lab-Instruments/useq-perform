import { render } from "solid-js/web";
import { Show, createSignal } from "solid-js";
import {
  PickerMenu,
  NumberPickerMenu,
  type PickerMenuItem,
  type PickerMenuProps,
  type NumberPickerMenuProps,
} from "../ui/PickerMenu";
import {
  HierarchicalPickerMenu,
  type HierarchicalCategory,
  type HierarchicalItem,
} from "../ui/HierarchicalPickerMenu";

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

type API = {
  showPickerMenu: (opts: {
    items: PickerMenuItem[];
    onSelect: (item: PickerMenuItem, index: number) => void;
    title?: string;
    layout?: "grid" | "vertical";
    initialIndex?: number;
  }) => () => void;
  showNumberPickerMenu: (opts: {
    onSelect: (value: number) => void;
    title?: string;
    initialValue?: number;
    min?: number;
    max?: number;
    step?: number;
  }) => () => void;
  showHierarchicalGridPicker: (opts: {
    categories: HierarchicalCategory[];
    title?: string;
    onSelect: (item: HierarchicalItem) => void;
  }) => () => void;
  close: () => void;
};

declare global {
  interface Window {
    __pickerMenu?: API;
  }
}

function ensureRootElement() {
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

const root = ensureRootElement();

const [menuState, setMenuState] = createSignal<MenuState>({ kind: "closed" });

function close() {
  setMenuState({ kind: "closed" });
}

function showPickerMenu(opts: {
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
      onClose: close,
      title: opts.title,
      layout: opts.layout,
      initialIndex: opts.initialIndex,
    },
  });
  return close;
}

function showNumberPickerMenu(opts: {
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
      onClose: close,
      title: opts.title,
      initialValue: opts.initialValue,
      min: opts.min,
      max: opts.max,
      step: opts.step,
    },
  });
  return close;
}

function showHierarchicalGridPicker(opts: {
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
  return close;
}

window.__pickerMenu = {
  showPickerMenu,
  showNumberPickerMenu,
  showHierarchicalGridPicker,
  close,
};

render(
  () => {
    const state = menuState();
    return (
      <Show when={state.kind !== "closed"}>
        <div style={{ "pointer-events": "auto" }}>
          <Show when={state.kind === "picker" && state}>
            {(s) => {
              const st = s() as Extract<MenuState, { kind: "picker" }>;
              return (
                <PickerMenu
                  items={st.opts.items}
                  onSelect={st.opts.onSelect}
                  onClose={close}
                  title={st.opts.title}
                  layout={st.opts.layout}
                  initialIndex={st.opts.initialIndex}
                />
              );
            }}
          </Show>
          <Show when={state.kind === "number" && state}>
            {(s) => {
              const st = s() as Extract<MenuState, { kind: "number" }>;
              return (
                <NumberPickerMenu
                  onSelect={st.opts.onSelect}
                  onClose={close}
                  title={st.opts.title}
                  initialValue={st.opts.initialValue}
                  min={st.opts.min}
                  max={st.opts.max}
                  step={st.opts.step}
                />
              );
            }}
          </Show>
          <Show when={state.kind === "hierarchical" && state}>
            {(s) => {
              const st = s() as Extract<MenuState, { kind: "hierarchical" }>;
              return (
                <HierarchicalPickerMenu
                  categories={st.categories}
                  title={st.title}
                  onSelect={(item) => {
                    st.onSelect(item);
                    close();
                  }}
                  onClose={close}
                />
              );
            }}
          </Show>
        </div>
      </Show>
    );
  },
  root,
);
