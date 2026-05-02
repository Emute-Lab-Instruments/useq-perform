// src/ui/liveEdit/LiveEditCard.tsx
//
// One panel card for a single live-edit slot.
//
// Spec: docs/specs/live-edit.md §5.1.2 (card content), §5.4 (card actions),
// §4.2 (widget visuals — sized larger here per §5.1.2).
//
// Pure prop-driven. No imports from runtime/effects/transport/persistence.
// MIDI-learn flow internals live elsewhere (gii8.43); this card just renders
// whatever learn/binding state is passed in via props.

import { Show, For, createSignal, createMemo } from "solid-js";
import type { LiveEditSlot, SlotValue } from "../../contracts/liveEdit.ts";
import type { MidiBinding, MidiSource } from "../../contracts/midi.ts";

export interface LiveEditCardProps {
  slot: LiveEditSlot;
  binding?: MidiBinding;
  /** True when this card is the active MIDI-learn target. */
  listening: boolean;
  /** Gamepad / cursor focus marker. */
  focused: boolean;
  onValueChange: (value: SlotValue) => void;
  onRename: (name: string) => void;
  onResetToSeed: () => void;
  onUnmark: () => void;
  onStartLearn: () => void;
  onClearBinding: () => void;
}

export function LiveEditCard(props: LiveEditCardProps) {
  const [menuOpen, setMenuOpen] = createSignal(false);

  const cardClasses = createMemo(() => {
    const base = ["le-panel-card"];
    if (props.focused) base.push("is-focused");
    if (props.listening || props.slot.state === "listening") base.push("is-listening");
    if (props.slot.state === "error") base.push("is-error");
    if (props.slot.state === "wasm-preview") base.push("is-wasm-preview");
    return base.join(" ");
  });

  const stateBadge = createMemo(() => {
    const s = props.slot.state;
    if (s === "error") return { label: "error", cls: "is-error" };
    if (s === "listening" || props.listening) return { label: "learning", cls: "is-listening" };
    if (s === "wasm-preview") return { label: "wasm only", cls: "is-wasm-preview" };
    if (s === "uninitialised") return { label: "init…", cls: "" };
    if (s === "runtime-disabled") return { label: "no runtime", cls: "" };
    return null;
  });

  const handleNameInput = (e: InputEvent & { currentTarget: HTMLInputElement }) => {
    props.onRename(e.currentTarget.value);
  };

  return (
    <div
      class={cardClasses()}
      data-slot-id={props.slot.id}
      data-state={props.slot.state}
    >
      <div class="le-panel-card-drag-handle" aria-hidden="true" title="Drag to reorder">
        ⋮⋮
      </div>

      <div class="le-panel-card-header">
        <input
          type="text"
          class={`le-panel-card-name${props.slot.name ? "" : " is-unnamed"}`}
          value={props.slot.name ?? `unnamed-${props.slot.id}`}
          placeholder={`unnamed-${props.slot.id}`}
          onInput={handleNameInput}
          spellcheck={false}
        />
        <span class="le-panel-card-id-tag">:{props.slot.id}</span>
        <Show when={stateBadge()}>
          {(badge) => (
            <span class={`le-panel-card-state-badge ${badge().cls}`}>{badge().label}</span>
          )}
        </Show>
      </div>

      <div class="le-panel-card-body">
        <div class="le-panel-card-control">
          <SlotControl slot={props.slot} onValueChange={props.onValueChange} />
        </div>
        <div
          class={`le-panel-card-readout${props.slot.modified ? " is-modified" : ""}`}
        >
          {formatValue(props.slot)}
          <Show when={props.slot.modified}>
            <span class="le-panel-card-readout-aux">
              seed: {formatSeed(props.slot)}
            </span>
          </Show>
        </div>
      </div>

      <div class="le-panel-card-footer">
        <button
          type="button"
          class={`le-panel-card-affordance${
            props.listening || props.slot.state === "listening" ? " is-listening" : ""
          }${props.binding ? " is-bound" : ""}`}
          onClick={() => props.onStartLearn()}
          title={props.binding ? "Re-learn MIDI binding" : "Bind a MIDI control"}
        >
          {props.listening || props.slot.state === "listening"
            ? "● LISTENING"
            : props.binding
            ? `◉ ${formatBinding(props.binding.source)}`
            : "◉ LRN"}
        </button>

        <Show when={props.binding}>
          <button
            type="button"
            class="le-panel-card-affordance"
            onClick={() => props.onClearBinding()}
            title="Clear MIDI binding"
          >
            ✕
          </button>
        </Show>

        <div class="le-panel-card-overflow" style={{ position: "relative" }}>
          <button
            type="button"
            class="le-panel-card-affordance"
            onClick={() => setMenuOpen((v) => !v)}
            aria-haspopup="menu"
            aria-expanded={menuOpen()}
            title="More actions"
          >
            ⋮
          </button>
          <Show when={menuOpen()}>
            <div class="le-panel-card-menu" role="menu">
              <button
                type="button"
                class="le-panel-card-menu-item"
                onClick={() => {
                  props.onResetToSeed();
                  setMenuOpen(false);
                }}
                disabled={!props.slot.modified}
              >
                Reset to seed
              </button>
              <button
                type="button"
                class="le-panel-card-menu-item"
                onClick={() => {
                  props.onStartLearn();
                  setMenuOpen(false);
                }}
              >
                {props.binding ? "Re-learn MIDI…" : "MIDI learn…"}
              </button>
              <Show when={props.binding}>
                <button
                  type="button"
                  class="le-panel-card-menu-item"
                  onClick={() => {
                    props.onClearBinding();
                    setMenuOpen(false);
                  }}
                >
                  Clear MIDI binding
                </button>
              </Show>
              <hr class="le-panel-card-menu-separator" />
              <button
                type="button"
                class="le-panel-card-menu-item is-destructive"
                onClick={() => {
                  props.onUnmark();
                  setMenuOpen(false);
                }}
              >
                Unmark live-edit
              </button>
            </div>
          </Show>
        </div>
      </div>
    </div>
  );
}

// ── Inner controls ────────────────────────────────────────────────────────

function SlotControl(props: {
  slot: LiveEditSlot;
  onValueChange: (value: SlotValue) => void;
}) {
  return (
    <Show
      when={props.slot.kind === "boolean"}
      fallback={
        <Show
          when={props.slot.kind === "keyword"}
          fallback={
            <KnobControl
              slot={props.slot}
              onValueChange={(v) => props.onValueChange(v)}
            />
          }
        >
          <PickerControl
            slot={props.slot}
            onValueChange={(v) => props.onValueChange(v)}
          />
        </Show>
      }
    >
      <ToggleControl
        slot={props.slot}
        onValueChange={(v) => props.onValueChange(v)}
      />
    </Show>
  );
}

function KnobControl(props: {
  slot: LiveEditSlot;
  onValueChange: (value: number) => void;
}) {
  const min = () => props.slot.min ?? 0;
  const max = () => props.slot.max ?? 1;
  const value = () => Number(props.slot.value);

  // Sweep ~270°: 7 o'clock (-135°) → 5 o'clock (+135°) per §4.2
  const SWEEP_START = -135;
  const SWEEP_END = 135;
  const norm = createMemo(() => {
    const lo = min();
    const hi = max();
    if (hi <= lo) return 0.5;
    return Math.max(0, Math.min(1, (value() - lo) / (hi - lo)));
  });
  const indicatorRotation = createMemo(
    () => SWEEP_START + (SWEEP_END - SWEEP_START) * norm(),
  );

  const seedNorm = createMemo(() => {
    const lo = min();
    const hi = max();
    const seed = Number(props.slot.seed);
    if (hi <= lo) return 0.5;
    return Math.max(0, Math.min(1, (seed - lo) / (hi - lo)));
  });
  const seedRotation = createMemo(
    () => SWEEP_START + (SWEEP_END - SWEEP_START) * seedNorm(),
  );

  // Stub interactivity: clicking on the knob nudges by step.
  // Real drag handling is a full mouse-state machine; out of scope for
  // this UI-scaffolding pass (gii8.40). Real wiring lands separately.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const step = props.slot.step ?? 0.01;
    const dir = e.deltaY < 0 ? 1 : -1;
    const next = Math.max(min(), Math.min(max(), value() + dir * step));
    props.onValueChange(next);
  };

  return (
    <div
      class="le-panel-knob"
      onWheel={onWheel}
      role="slider"
      aria-valuemin={min()}
      aria-valuemax={max()}
      aria-valuenow={value()}
      aria-label={props.slot.name ?? props.slot.id}
      tabIndex={0}
    >
      <div class="le-panel-knob-track" />
      <div
        class="le-panel-knob-seed-tick"
        style={{ transform: `translate(-50%, -100%) rotate(${seedRotation()}deg)` }}
        aria-hidden="true"
      />
      <div
        class="le-panel-knob-indicator"
        style={{ transform: `translate(-50%, -100%) rotate(${indicatorRotation()}deg)` }}
      />
    </div>
  );
}

function ToggleControl(props: {
  slot: LiveEditSlot;
  onValueChange: (value: boolean) => void;
}) {
  const on = () => Boolean(props.slot.value);
  return (
    <button
      type="button"
      class="le-panel-toggle"
      role="switch"
      aria-checked={on()}
      aria-label={props.slot.name ?? props.slot.id}
      onClick={() => props.onValueChange(!on())}
    >
      <span class={`le-panel-toggle-segment${!on() ? " is-active" : ""}`}>off</span>
      <span class={`le-panel-toggle-segment${on() ? " is-active" : ""}`}>on</span>
    </button>
  );
}

function PickerControl(props: {
  slot: LiveEditSlot;
  onValueChange: (value: string) => void;
}) {
  const options = () => props.slot.options ?? [];
  const current = () => String(props.slot.value);
  return (
    <div class="le-panel-picker" role="radiogroup" aria-label={props.slot.name ?? props.slot.id}>
      <For each={options()}>
        {(opt) => (
          <button
            type="button"
            role="radio"
            aria-checked={opt === current()}
            class={`le-panel-picker-option${opt === current() ? " is-active" : ""}`}
            onClick={() => props.onValueChange(opt)}
          >
            :{opt}
          </button>
        )}
      </For>
    </div>
  );
}

// ── Formatting helpers ────────────────────────────────────────────────────

function formatValue(slot: LiveEditSlot): string {
  switch (slot.kind) {
    case "boolean":
      return slot.value ? "on" : "off";
    case "keyword":
      return `:${String(slot.value)}`;
    case "numeric":
    case "vector-element": {
      const precision = slot.precision ?? defaultPrecision(slot.seed);
      return Number(slot.value).toFixed(precision);
    }
  }
}

function formatSeed(slot: LiveEditSlot): string {
  switch (slot.kind) {
    case "boolean":
      return slot.seed ? "on" : "off";
    case "keyword":
      return `:${String(slot.seed)}`;
    default: {
      const precision = slot.precision ?? defaultPrecision(slot.seed);
      return Number(slot.seed).toFixed(precision);
    }
  }
}

function defaultPrecision(seed: SlotValue): number {
  if (typeof seed !== "number") return 0;
  const decimals = (String(seed).split(".")[1] ?? "").length;
  return Math.max(2, decimals + 1);
}

function formatBinding(source: MidiSource): string {
  if (source.kind === "cc") {
    const ch = source.channel === "any" ? "" : `Ch${source.channel} `;
    return `${ch}CC${source.controller}`;
  }
  // note
  const ch = source.channel === "any" ? "" : `Ch${source.channel} `;
  const noteName = midiNoteName(source.note);
  const tag = source.mode === "toggle" ? " tog" : " vel";
  return `${ch}${noteName}${tag}`;
}

function midiNoteName(midi: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const octave = Math.floor(midi / 12) - 1;
  const name = names[((midi % 12) + 12) % 12];
  return `${name}${octave}`;
}
