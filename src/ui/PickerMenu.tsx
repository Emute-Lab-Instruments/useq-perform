import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
  type Component,
} from "solid-js";
import { pushOverlay } from "./overlayManager";
import * as gamepadCh from "../contracts/gamepadChannels";

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
      e.stopPropagation();
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
        e.preventDefault();
        e.stopPropagation();
        const maxColInRow =
          Math.min(NUM_COLUMNS, len - currentRow * NUM_COLUMNS) - 1;
        newCol = currentCol < maxColInRow ? currentCol + 1 : 0;
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        e.stopPropagation();
        newCol = currentCol > 0 ? currentCol - 1 : NUM_COLUMNS - 1;
        if (newRow * NUM_COLUMNS + newCol >= len) {
          newCol = len - 1 - newRow * NUM_COLUMNS;
        }
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        e.stopPropagation();
        newRow = currentRow < numRows - 1 ? currentRow + 1 : 0;
        if (newRow * NUM_COLUMNS + currentCol >= len) newRow = 0;
        newCol = currentCol;
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
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
        e.preventDefault();
        e.stopPropagation();
        setActive((activeIdx() + 1) % len);
      } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
        e.preventDefault();
        e.stopPropagation();
        setActive((activeIdx() - 1 + len) % len);
      }
    }
  };

  // Gamepad navigation via typed channels
  const handleGamepadNavigate = (detail: { direction?: string }) => {
    const len = items().length;
    if (!len) return;
    const { direction } = detail;

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

  // Non-Escape keyboard navigation — captured at window level to intercept
  // before CodeMirror processes the key. Escape is handled by the overlay manager.
  const handleKeyDownNav = (e: KeyboardEvent) => {
    if (e.key === "Escape") return; // Escape is handled by the overlay manager
    handleKeyDown(e);
  };

  let popOverlay: (() => void) | undefined;
  let unsubNavigate: (() => void) | undefined;
  let unsubSelect: (() => void) | undefined;
  let unsubCancel: (() => void) | undefined;
  onMount(() => {
    window.addEventListener("keydown", handleKeyDownNav, true);
    unsubNavigate = gamepadCh.pickerNavigate.subscribe(handleGamepadNavigate);
    unsubSelect = gamepadCh.pickerSelect.subscribe(() => selectItem(activeIdx()));
    unsubCancel = gamepadCh.pickerCancel.subscribe(() => close());
    popOverlay = pushOverlay("picker-menu", () => close());
    focusActive();
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDownNav, true);
    unsubNavigate?.();
    unsubSelect?.();
    unsubCancel?.();
    popOverlay?.();
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

// --- Number Picker (Numpad/T9 Entry) ---

export type NumberPickerMenuProps = {
  onSelect: (value: number) => void;
  onClose?: () => void;
  title?: string;
  initialValue?: number;
  min?: number;
  max?: number;
  step?: number;
};

/**
 * Numpad entry surface for filling number-type holes.
 *
 * Accepts digits (0-9), decimal point, and minus sign via keyboard or
 * on-screen numpad buttons. Gamepad d-pad navigates the numpad grid;
 * A confirms, B cancels.
 */
export function NumberPickerMenu(props: NumberPickerMenuProps) {
  const title = () => props.title ?? "Enter number";
  const minVal = () => props.min ?? -Infinity;
  const maxVal = () => props.max ?? Infinity;

  // Buffer holds the text being typed (not a parsed number yet)
  const [buffer, setBuffer] = createSignal(
    props.initialValue != null ? String(props.initialValue) : ""
  );

  // Numpad button layout (phone-style T9 grid)
  const numpadKeys = [
    "7", "8", "9",
    "4", "5", "6",
    "1", "2", "3",
    "-", "0", ".",
  ];

  // Gamepad grid navigation state
  const [activeKey, setActiveKey] = createSignal(4); // Start on "5" (center)

  const parsedValue = (): number => {
    const v = parseFloat(buffer());
    if (Number.isNaN(v)) return 0;
    return Math.max(minVal(), Math.min(maxVal(), v));
  };

  const appendChar = (ch: string) => {
    const cur = buffer();
    // Prevent multiple decimal points
    if (ch === "." && cur.includes(".")) return;
    // Minus only at start
    if (ch === "-") {
      if (cur.startsWith("-")) {
        setBuffer(cur.slice(1));
      } else {
        setBuffer("-" + cur);
      }
      return;
    }
    setBuffer(cur + ch);
  };

  const backspace = () => {
    setBuffer(buffer().slice(0, -1));
  };

  const clearBuffer = () => {
    setBuffer("");
  };

  const confirm = () => {
    props.onSelect(parsedValue());
    props.onClose?.();
  };

  const close = () => {
    props.onClose?.();
  };

  // Keyboard handler: digits, decimal, minus, backspace, enter, escape
  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") return; // Handled by overlay manager
    if (e.key === "Enter") {
      e.preventDefault();
      confirm();
      return;
    }
    if (e.key === "Backspace") {
      e.preventDefault();
      backspace();
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      clearBuffer();
      return;
    }
    // Accept digit, decimal, minus from keyboard
    if (/^[0-9.\-]$/.test(e.key)) {
      e.preventDefault();
      appendChar(e.key);
      return;
    }
  };

  // Gamepad navigation across the numpad grid (3 columns x 4 rows)
  const NUM_COLS = 3;
  const NUM_ROWS = 4;

  const handleGamepadNavigate = (detail: { direction?: string }) => {
    const { direction } = detail;
    let row = Math.floor(activeKey() / NUM_COLS);
    let col = activeKey() % NUM_COLS;

    if (direction === "up" && row > 0) row--;
    else if (direction === "down" && row < NUM_ROWS - 1) row++;
    else if (direction === "left" && col > 0) col--;
    else if (direction === "right" && col < NUM_COLS - 1) col++;

    setActiveKey(row * NUM_COLS + col);
  };

  const handleGamepadSelect = () => {
    const key = numpadKeys[activeKey()];
    if (key != null) appendChar(key);
  };

  let popOverlay: (() => void) | undefined;
  let unsubNavigate: (() => void) | undefined;
  let unsubSelect: (() => void) | undefined;
  let unsubCancel: (() => void) | undefined;
  let unsubApply: (() => void) | undefined;
  onMount(() => {
    window.addEventListener("keydown", handleKeyDown, true);
    unsubNavigate = gamepadCh.pickerNavigate.subscribe(handleGamepadNavigate);
    unsubSelect = gamepadCh.pickerSelect.subscribe(handleGamepadSelect);
    unsubCancel = gamepadCh.pickerCancel.subscribe(() => close());
    // pickerApply (LB+A / RB+A / Start) confirms the entered number
    unsubApply = gamepadCh.pickerApply.subscribe(() => confirm());
    popOverlay = pushOverlay("number-picker-menu", () => close());
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown, true);
    unsubNavigate?.();
    unsubSelect?.();
    unsubCancel?.();
    unsubApply?.();
    popOverlay?.();
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
        <div class="numpad-display">
          <span class="numpad-display-value">
            {buffer() || "0"}
          </span>
        </div>
        <div class="numpad-grid">
          <For each={numpadKeys}>
            {(key, i) => (
              <button
                class={`numpad-key ${i() === activeKey() ? "active" : ""}`}
                onClick={() => appendChar(key)}
                onMouseEnter={() => setActiveKey(i())}
              >
                {key === "-" ? "+/-" : key}
              </button>
            )}
          </For>
        </div>
        <div class="numpad-actions">
          <button class="numpad-action-btn" onClick={backspace}>
            Bksp
          </button>
          <button class="numpad-action-btn numpad-confirm" onClick={confirm}>
            OK
          </button>
          <button class="numpad-action-btn" onClick={close}>
            Esc
          </button>
        </div>
      </div>
    </div>
  );
}
