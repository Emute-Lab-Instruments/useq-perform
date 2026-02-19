import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";

/** Map of icon name strings to icon components. Provided by the adapter (browser-only). */
export type IconRegistry = Record<string, Component>;

export type PickerMenuItem = {
  label: string;
  value?: unknown;
  icon?: string;
  [key: string]: unknown;
};

export type PickerMenuProps = {
  items: PickerMenuItem[];
  onSelect: (item: PickerMenuItem, index: number) => void;
  onClose?: () => void;
  title?: string;
  layout?: "grid" | "vertical";
  initialIndex?: number;
  /** Icon registry mapping icon name strings to components. Provided by the adapter in browser contexts. */
  iconRegistry?: IconRegistry;
};

export function PickerMenu(props: PickerMenuProps) {
  const layout = () => props.layout ?? "grid";
  const items = () => props.items;

  const computedInitial = () => {
    const idx = props.initialIndex;
    const len = items().length;
    if (!len) return 0;
    const i = typeof idx === "number" ? idx : Math.floor(len / 2);
    return Math.max(0, Math.min(len - 1, i));
  };

  const [activeIdx, setActiveIdx] = createSignal(computedInitial());

  let itemsRef: HTMLDivElement | undefined;

  const focusActive = () => {
    if (!itemsRef) return;
    const children = itemsRef.children;
    const el = children[activeIdx()] as HTMLElement | undefined;
    el?.focus();
  };

  const setActive = (idx: number) => {
    setActiveIdx(idx);
    focusActive();
  };

  const selectItem = (idx: number) => {
    const it = items()[idx];
    if (it) props.onSelect(it, idx);
    props.onClose?.();
  };

  const close = () => {
    props.onClose?.();
  };

  // Grid navigation helpers
  const NUM_COLUMNS = 3;

  const handleKeyDown = (e: KeyboardEvent) => {
    const len = items().length;
    if (!len) return;

    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      selectItem(activeIdx());
      return;
    }

    if (layout() === "grid") {
      const numRows = Math.ceil(len / NUM_COLUMNS);
      const currentRow = Math.floor(activeIdx() / NUM_COLUMNS);
      const currentCol = activeIdx() % NUM_COLUMNS;
      let newRow = currentRow;
      let newCol = currentCol;

      if (e.key === "ArrowLeft") {
        const maxColInRow =
          Math.min(NUM_COLUMNS, len - currentRow * NUM_COLUMNS) - 1;
        newCol = currentCol < maxColInRow ? currentCol + 1 : 0;
      } else if (e.key === "ArrowRight") {
        newCol = currentCol > 0 ? currentCol - 1 : NUM_COLUMNS - 1;
        if (newRow * NUM_COLUMNS + newCol >= len) {
          newCol = len - 1 - newRow * NUM_COLUMNS;
        }
      } else if (e.key === "ArrowUp") {
        newRow = currentRow < numRows - 1 ? currentRow + 1 : 0;
        if (newRow * NUM_COLUMNS + currentCol >= len) newRow = 0;
        newCol = currentCol;
      } else if (e.key === "ArrowDown") {
        newRow = currentRow > 0 ? currentRow - 1 : numRows - 1;
        if (newRow * NUM_COLUMNS + currentCol >= len) {
          newRow = Math.floor((len - 1) / NUM_COLUMNS);
        }
        newCol = currentCol;
      } else {
        return;
      }

      let newIdx = newRow * NUM_COLUMNS + newCol;
      newIdx = Math.max(0, Math.min(len - 1, newIdx));
      setActive(newIdx);
    } else {
      // Vertical layout (reversed to match legacy)
      if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
        setActive((activeIdx() + 1) % len);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        setActive((activeIdx() - 1 + len) % len);
      }
    }
  };

  // Gamepad navigation
  const handleGamepadInput = (e: Event) => {
    const len = items().length;
    if (!len) return;
    const { direction, action } = (e as CustomEvent).detail || {};

    if (action === "select") {
      selectItem(activeIdx());
      return;
    }
    if (action === "cancel") {
      close();
      return;
    }

    if (layout() === "grid") {
      const numRows = Math.ceil(len / NUM_COLUMNS);
      const currentRow = Math.floor(activeIdx() / NUM_COLUMNS);
      const currentCol = activeIdx() % NUM_COLUMNS;
      let newRow = currentRow;
      let newCol = currentCol;

      if (direction === "left") {
        const maxColInRow =
          Math.min(NUM_COLUMNS, len - currentRow * NUM_COLUMNS) - 1;
        newCol = currentCol < maxColInRow ? currentCol + 1 : 0;
      } else if (direction === "right") {
        newCol = currentCol > 0 ? currentCol - 1 : NUM_COLUMNS - 1;
        if (newRow * NUM_COLUMNS + newCol >= len) {
          newCol = len - 1 - newRow * NUM_COLUMNS;
        }
      } else if (direction === "up") {
        newRow = currentRow < numRows - 1 ? currentRow + 1 : 0;
        if (newRow * NUM_COLUMNS + currentCol >= len) newRow = 0;
        newCol = currentCol;
      } else if (direction === "down") {
        let tries = 0;
        do {
          newRow = newRow > 0 ? newRow - 1 : numRows - 1;
          tries++;
        } while (
          newRow * NUM_COLUMNS + currentCol >= len &&
          tries < numRows
        );
        newCol = currentCol;
      }

      let newIdx = newRow * NUM_COLUMNS + newCol;
      newIdx = Math.max(0, Math.min(len - 1, newIdx));
      if (newIdx !== activeIdx()) setActive(newIdx);
    } else {
      if (direction === "left" || direction === "up") {
        setActive((activeIdx() + 1) % len);
      } else if (direction === "right" || direction === "down") {
        setActive((activeIdx() - 1 + len) % len);
      }
    }
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(
      "gamepadpickerinput",
      handleGamepadInput as EventListener,
    );
    // Lock body scroll
    document.body.style.overflow = "hidden";
    focusActive();
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener(
      "gamepadpickerinput",
      handleGamepadInput as EventListener,
    );
    document.body.style.overflow = "";
  });

  return (
    <div
      class="picker-menu-overlay visible"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div class="picker-menu visible" role="dialog" aria-modal="true">
        <Show when={props.title}>
          <div class="picker-menu-title">{props.title}</div>
        </Show>
        <div
          ref={itemsRef}
          class={`picker-menu-items ${layout() === "vertical" ? "vertical" : "grid"}`}
        >
          <For each={items()}>
            {(item, i) => (
              <div
                class={`picker-menu-item ${i() === activeIdx() ? "active" : ""}`}
                tabIndex={0}
                onClick={(e) => {
                  e.stopPropagation();
                  selectItem(i());
                }}
                onMouseEnter={() => setActiveIdx(i())}
                onFocus={() => setActiveIdx(i())}
              >
                <Show when={item.icon && props.iconRegistry?.[item.icon!]}>
                  {(() => { const Icon = props.iconRegistry![item.icon!]; return <Icon />; })()}{" "}
                </Show>
                {item.label}
              </div>
            )}
          </For>
        </div>
      </div>
    </div>
  );
}

// --- Number Picker ---

export type NumberPickerMenuProps = {
  onSelect: (value: number) => void;
  onClose?: () => void;
  title?: string;
  initialValue?: number;
  min?: number;
  max?: number;
  step?: number;
};

export function NumberPickerMenu(props: NumberPickerMenuProps) {
  const title = () => props.title ?? "Pick a number";
  const step = () => props.step ?? 1;
  const minVal = () => props.min ?? -Infinity;
  const maxVal = () => props.max ?? Infinity;

  const clampedInit = () => {
    const v = props.initialValue ?? 0;
    return Math.max(minVal(), Math.min(maxVal(), v));
  };

  const [value, setValue] = createSignal(clampedInit());

  let inputRef: HTMLInputElement | undefined;

  const updateValue = (v: number) => {
    setValue(Math.max(minVal(), Math.min(maxVal(), v)));
  };

  const confirm = () => {
    props.onSelect(value());
    props.onClose?.();
  };

  const close = () => {
    props.onClose?.();
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") close();
    else if (e.key === "Enter") confirm();
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown")
      updateValue(value() - step());
    else if (e.key === "ArrowRight" || e.key === "ArrowUp")
      updateValue(value() + step());
  };

  const handleGamepadInput = (e: Event) => {
    const { direction, action } = (e as CustomEvent).detail || {};
    if (direction === "left" || direction === "down")
      updateValue(value() - step());
    else if (direction === "right" || direction === "up")
      updateValue(value() + step());
    else if (action === "select") confirm();
    else if (action === "cancel") close();
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(
      "gamepadpickerinput",
      handleGamepadInput as EventListener,
    );
    document.body.style.overflow = "hidden";
    inputRef?.focus();
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener(
      "gamepadpickerinput",
      handleGamepadInput as EventListener,
    );
    document.body.style.overflow = "";
  });

  return (
    <div
      class="picker-menu-overlay visible"
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div
        class="picker-menu number-picker-menu visible"
        role="dialog"
        aria-modal="true"
      >
        <Show when={title()}>
          <div class="picker-menu-title">{title()}</div>
        </Show>
        <div class="number-picker-row">
          <button
            class="number-picker-btn"
            onClick={() => updateValue(value() - step())}
          >
            −
          </button>
          <input
            ref={inputRef}
            class="number-picker-input"
            type="number"
            value={value()}
            min={minVal()}
            max={maxVal()}
            step={step()}
            onInput={(e) =>
              updateValue(Number(e.currentTarget.value) || 0)
            }
          />
          <button
            class="number-picker-btn"
            onClick={() => updateValue(value() + step())}
          >
            +
          </button>
        </div>
        <div class="number-picker-actions">
          <button class="picker-menu-action" onClick={confirm}>
            OK
          </button>
          <button class="picker-menu-action" onClick={close}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
