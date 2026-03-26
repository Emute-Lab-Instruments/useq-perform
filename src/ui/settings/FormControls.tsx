import { JSX, createEffect, createSignal, Show, onMount, onCleanup } from "solid-js";
import { settingsQuery } from "./settingsSearch";

const matches = (text: string, query: string) =>
  !query || text.toLowerCase().includes(query.toLowerCase());

/** Collapsible section. Collapsed by default unless defaultOpen is true. */
export function Section(props: {
  title: string;
  children: JSX.Element;
  defaultOpen?: boolean;
}) {
  const [manualOpen, setManualOpen] = createSignal(props.defaultOpen === true);
  const searching = () => !!settingsQuery();
  // When searching, force open so FormRow filtering can work inside
  const isOpen = () => searching() || manualOpen();

  return (
    <div class="panel-section" classList={{ "panel-section--open": isOpen() }}>
      <button
        class="panel-section-toggle"
        onClick={() => setManualOpen(!manualOpen())}
      >
        <span class="panel-section-arrow">{isOpen() ? "\u25BE" : "\u25B8"}</span>
        <h3 class="panel-section-title">{props.title}</h3>
      </button>
      <Show when={isOpen()}>
        <div class="panel-section-body">{props.children}</div>
      </Show>
    </div>
  );
}

/** Sub-group inside a section — lighter-weight, also collapsible. */
export function SubGroup(props: {
  label: string;
  children: JSX.Element;
  defaultOpen?: boolean;
}) {
  const [manualOpen, setManualOpen] = createSignal(props.defaultOpen === true);
  const isOpen = () => settingsQuery() ? true : manualOpen();

  return (
    <div class="panel-subgroup" classList={{ "panel-subgroup--open": isOpen() }}>
      <button
        class="panel-subgroup-toggle"
        onClick={() => setManualOpen(!manualOpen())}
      >
        <span class="panel-subgroup-arrow">{isOpen() ? "\u25BE" : "\u25B8"}</span>
        <span class="panel-subgroup-label">{props.label}</span>
      </button>
      <Show when={isOpen()}>
        <div class="panel-subgroup-body">{props.children}</div>
      </Show>
    </div>
  );
}

export function FormRow(props: { label: string; children: JSX.Element }) {
  const visible = () => matches(props.label, settingsQuery());

  return (
    <Show when={visible()}>
      <div class="panel-row">
        <label class="panel-label">{props.label}</label>
        <div class="panel-control">{props.children}</div>
      </div>
    </Show>
  );
}

export function TextInput(props: {
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      type="text"
      class="panel-text-input"
      value={props.value}
      placeholder={props.placeholder}
      onInput={(e) => props.onChange(e.currentTarget.value)}
    />
  );
}

/**
 * Number input with hidden spinners and vertical drag-to-adjust.
 * Drag up to increase, down to decrease. Click to type directly.
 */
export function NumberInput(props: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [dragging, setDragging] = createSignal(false);
  const [editing, setEditing] = createSignal(false);
  let startY = 0;
  let startValue = 0;
  let moved = false;
  let inputRef: HTMLInputElement | undefined;

  const step = () => props.step ?? 1;

  const clamp = (v: number) => {
    let val = v;
    if (props.min !== undefined) val = Math.max(props.min, val);
    if (props.max !== undefined) val = Math.min(props.max, val);
    return val;
  };

  const onPointerDown = (e: PointerEvent) => {
    if (props.disabled || editing()) return;
    startY = e.clientY;
    startValue = props.value;
    moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);

    const onMove = (me: PointerEvent) => {
      // Negative because dragging UP should increase
      const dy = startY - me.clientY;
      if (Math.abs(dy) > 3) {
        if (!moved) {
          moved = true;
          setDragging(true);
        }
        const sensitivity = me.shiftKey ? 0.1 : 1;
        const delta = Math.round(dy / 4) * step() * sensitivity;
        const newVal = clamp(startValue + delta);
        props.onChange(parseFloat(newVal.toFixed(10)));
      }
    };

    const onUp = () => {
      setDragging(false);
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      if (!moved) {
        setEditing(true);
        requestAnimationFrame(() => {
          inputRef?.focus();
          inputRef?.select();
        });
      }
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  };

  const onBlur = () => {
    setEditing(false);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Escape") {
      setEditing(false);
      inputRef?.blur();
    }
  };

  return (
    <div
      class="panel-number-drag"
      classList={{
        "panel-number-drag--dragging": dragging(),
        "panel-number-drag--editing": editing(),
        "panel-number-drag--disabled": !!props.disabled,
      }}
      onPointerDown={onPointerDown}
    >
      <input
        ref={inputRef}
        type="number"
        class="panel-number-input"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        readOnly={!editing()}
        tabIndex={editing() ? 0 : -1}
        onInput={(e) => {
          const val = parseInt(e.currentTarget.value, 10);
          if (!isNaN(val)) props.onChange(val);
        }}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      <span class="panel-number-drag-hint">{"\u2195"}</span>
    </div>
  );
}

export function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label class="panel-toggle">
      <input
        type="checkbox"
        class="panel-toggle-input"
        checked={props.checked}
        onInput={(e) => props.onChange(e.currentTarget.checked)}
      />
      <span class="panel-toggle-track">
        <span class="panel-toggle-thumb" />
      </span>
    </label>
  );
}

export function Select(props: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      class="panel-select"
      value={props.value}
      onChange={(e) => props.onChange(e.currentTarget.value)}
    >
      {props.options.map((opt) => (
        <option value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

/**
 * Fully custom range slider — no native <input type="range"> styling issues.
 * Built from div track + thumb, with pointer drag handling.
 * Hidden native input for accessibility (keyboard, aria).
 */
export function RangeInput(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  formatValue?: (val: number) => string;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const [displayValue, setDisplayValue] = createSignal(props.value);
  const [dragging, setDragging] = createSignal(false);
  const [hovering, setHovering] = createSignal(false);
  let trackRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (!dragging()) setDisplayValue(props.value);
  });

  const percentage = () => {
    const range = props.max - props.min;
    if (range === 0) return 0;
    return Math.max(0, Math.min(100, ((displayValue() - props.min) / range) * 100));
  };

  const snap = (raw: number) => {
    const step = props.step;
    const snapped = Math.round((raw - props.min) / step) * step + props.min;
    return Math.max(props.min, Math.min(props.max, parseFloat(snapped.toFixed(10))));
  };

  const valueFromPointer = (clientX: number) => {
    if (!trackRef) return props.value;
    const rect = trackRef.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return snap(props.min + pct * (props.max - props.min));
  };

  const onPointerDown = (e: PointerEvent) => {
    if (props.disabled) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragging(true);
    const val = valueFromPointer(e.clientX);
    setDisplayValue(val);
  };

  const onPointerMove = (e: PointerEvent) => {
    if (!dragging()) return;
    const val = valueFromPointer(e.clientX);
    setDisplayValue(val);
  };

  const onPointerUp = () => {
    if (!dragging()) return;
    setDragging(false);
    props.onChange(displayValue());
  };

  // Hidden native input for keyboard accessibility
  const onNativeInput = (e: Event) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setDisplayValue(val);
  };

  const onNativeChange = (e: Event) => {
    const val = parseFloat((e.target as HTMLInputElement).value);
    setDisplayValue(val);
    props.onChange(val);
  };

  return (
    <div
      class="panel-range"
      classList={{
        "panel-range--disabled": !!props.disabled,
        "panel-range--active": dragging(),
        "panel-range--hover": hovering(),
      }}
    >
      <div
        class="panel-range-track"
        ref={trackRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerEnter={() => setHovering(true)}
        onPointerLeave={() => setHovering(false)}
      >
        {/* Filled portion */}
        <div
          class="panel-range-fill"
          style={{ width: `${percentage()}%` }}
        />
        {/* Tick marks at 0%, 25%, 50%, 75%, 100% */}
        <div class="panel-range-ticks">
          <span class="panel-range-tick" style={{ left: "0%" }} />
          <span class="panel-range-tick" style={{ left: "25%" }} />
          <span class="panel-range-tick" style={{ left: "50%" }} />
          <span class="panel-range-tick" style={{ left: "75%" }} />
          <span class="panel-range-tick" style={{ left: "100%" }} />
        </div>
        {/* Thumb */}
        <div
          class="panel-range-thumb"
          style={{ left: `${percentage()}%` }}
        />
      </div>
      {/* Hidden native input for screen readers + keyboard */}
      <input
        type="range"
        class="panel-range-native"
        role="slider"
        min={props.min}
        max={props.max}
        step={props.step}
        value={displayValue()}
        disabled={props.disabled}
        aria-valuenow={displayValue()}
        aria-valuemin={props.min}
        aria-valuemax={props.max}
        onInput={onNativeInput}
        onChange={onNativeChange}
      />
      <span class="panel-range-value">
        {props.formatValue
          ? props.formatValue(displayValue())
          : displayValue()}
      </span>
    </div>
  );
}
