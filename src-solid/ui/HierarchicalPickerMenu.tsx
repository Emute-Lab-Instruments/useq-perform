import { Show, createSignal } from "solid-js";
import {
  PickerMenu,
  NumberPickerMenu,
  type PickerMenuItem,
} from "./PickerMenu";

export type HierarchicalCategory = {
  label: string;
  id?: string;
  items: HierarchicalItem[];
  [key: string]: unknown;
};

export type HierarchicalItem = {
  label: string;
  value?: unknown;
  icon?: string;
  insertText?: string;
  special?: string;
  [key: string]: unknown;
};

export type HierarchicalPickerMenuProps = {
  categories: HierarchicalCategory[];
  title?: string;
  onSelect: (item: HierarchicalItem) => void;
  onClose?: () => void;
};

type ViewState =
  | { kind: "categories" }
  | { kind: "items"; category: HierarchicalCategory }
  | { kind: "number" };

export function HierarchicalPickerMenu(props: HierarchicalPickerMenuProps) {
  const title = () => props.title ?? "Create";
  const [view, setView] = createSignal<ViewState>({ kind: "categories" });

  const close = () => {
    props.onClose?.();
  };

  const handleCategorySelect = (item: PickerMenuItem) => {
    const cat = props.categories.find((c) => c.id === item.value) ||
      props.categories[0];
    if (cat) {
      setView({ kind: "items", category: cat });
    }
  };

  const handleItemSelect = (item: PickerMenuItem) => {
    const currentView = view();
    if (currentView.kind !== "items") return;

    const original = currentView.category.items.find(
      (x) => x.label === item.label && x.value === item.value,
    ) || ({} as HierarchicalItem);

    if (original.special === "number") {
      setView({ kind: "number" });
      return;
    }

    close();
    props.onSelect(
      original.insertText
        ? original
        : { ...original, insertText: `(${String(original.value)} )` },
    );
  };

  const handleNumberSelect = (num: number) => {
    close();
    props.onSelect({ label: String(num), value: num, insertText: String(num) });
  };

  return (
    <>
      <Show when={view().kind === "categories"}>
        <PickerMenu
          items={props.categories.map((c) => ({ label: c.label, value: c.id }))}
          title={title()}
          layout="grid"
          initialIndex={0}
          onSelect={handleCategorySelect}
          onClose={close}
        />
      </Show>
      <Show when={view().kind === "items"}>
        {(() => {
          const v = view();
          if (v.kind !== "items") return null;
          const cat = v.category;
          return (
            <PickerMenu
              items={cat.items.map((it) => ({
                label: it.label,
                value: it.value,
                icon: it.icon,
              }))}
              title={`${title()}: ${cat.label}`}
              layout="grid"
              initialIndex={0}
              onSelect={handleItemSelect}
              onClose={close}
            />
          );
        })()}
      </Show>
      <Show when={view().kind === "number"}>
        <NumberPickerMenu
          title="Pick a Number"
          initialValue={0}
          onSelect={handleNumberSelect}
          onClose={close}
        />
      </Show>
    </>
  );
}
