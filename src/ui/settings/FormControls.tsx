import { JSX, createEffect, createSignal } from "solid-js";

export function Section(props: { title: string; children: JSX.Element }) {
  return (
    <div class="panel-section">
      <h3 class="panel-section-title">{props.title}</h3>
      {props.children}
    </div>
  );
}

export function FormRow(props: { label: string; children: JSX.Element }) {
  return (
    <div class="panel-row">
      <label class="panel-label">{props.label}</label>
      <div class="panel-control">{props.children}</div>
    </div>
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

export function NumberInput(props: {
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      class="panel-number-input"
      min={props.min}
      max={props.max}
      step={props.step}
      value={props.value}
      disabled={props.disabled}
      onInput={(e) => props.onChange(parseInt(e.currentTarget.value, 10))}
    />
  );
}

export function Checkbox(props: {
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <input
      type="checkbox"
      class="panel-checkbox"
      checked={props.checked}
      onInput={(e) => props.onChange(e.currentTarget.checked)}
    />
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
        <option value={opt.value} selected={opt.value === props.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

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

  createEffect(() => {
    setDisplayValue(props.value);
  });

  return (
    <div class={`panel-range-wrapper ${props.disabled ? 'panel-range-wrapper--disabled' : ''}`}>
      <input
        type="range"
        class={`panel-range-input ${props.disabled ? 'panel-control-disabled' : ''}`}
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onInput={(e) => setDisplayValue(parseFloat(e.currentTarget.value))}
        onChange={(e) => props.onChange(parseFloat(e.currentTarget.value))}
      />
      <span class="panel-range-value">
        {props.formatValue
          ? props.formatValue(displayValue())
          : displayValue()}
      </span>
    </div>
  );
}
