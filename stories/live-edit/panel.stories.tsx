// stories/live-edit/panel.stories.tsx
//
// Storybook stories for the dockable live-edit panel.
// Mirrors the prop-driven + createStore pattern from
// stories/settings/general.stories.tsx.

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createSignal, type JSX } from "solid-js";
import { createStore, produce } from "solid-js/store";
import { LiveEditPanel } from "@src/ui/liveEdit/LiveEditPanel";
import type {
  LiveEditPanelOrder,
  LiveEditSlot,
  SlotValue,
} from "@src/contracts/liveEdit";
import type { MidiBinding, MidiLearnState } from "@src/contracts/midi";

// ── Mock-state harness ────────────────────────────────────────────────────

interface PanelHarnessProps {
  initialSlots: LiveEditSlot[];
  initialOrder?: LiveEditPanelOrder;
  initialBindings?: MidiBinding[];
  initialLearnState?: MidiLearnState;
  initialFocusedSlotId?: string;
}

function PanelHarness(props: PanelHarnessProps): JSX.Element {
  const [state, setState] = createStore({
    slots: props.initialSlots,
    order: props.initialOrder ?? ({ mode: "document" } as LiveEditPanelOrder),
    bindings: new Map(
      (props.initialBindings ?? []).map((b) => [b.slotId, b]),
    ),
    learnState:
      props.initialLearnState ?? ({ mode: "idle" } as MidiLearnState),
    focusedSlotId: props.initialFocusedSlotId,
  });

  const [closed, setClosed] = createSignal(false);

  const findIdx = (slotId: string) =>
    state.slots.findIndex((s) => s.id === slotId);

  const updateSlot = (slotId: string, patch: Partial<LiveEditSlot>) => {
    setState(
      produce((s) => {
        const i = s.slots.findIndex((x) => x.id === slotId);
        if (i >= 0) Object.assign(s.slots[i], patch);
      }),
    );
  };

  return (
    <div
      style={{
        width: "360px",
        height: "640px",
        background: "#0b1220",
        display: "flex",
      }}
    >
      {closed() ? (
        <div
          style={{
            margin: "auto",
            color: "#888",
            "font-family": "monospace",
            "font-size": "13px",
          }}
        >
          Panel closed. Refresh story to reopen.
        </div>
      ) : (
        <LiveEditPanel
          slots={state.slots}
          order={state.order}
          bindings={state.bindings}
          learnState={state.learnState}
          focusedSlotId={state.focusedSlotId}
          onValueChange={(slotId, value: SlotValue) => {
            const i = findIdx(slotId);
            if (i < 0) return;
            updateSlot(slotId, {
              value,
              modified:
                state.slots[i].kind === "boolean"
                  ? value !== state.slots[i].seed
                  : state.slots[i].kind === "keyword"
                    ? value !== state.slots[i].seed
                    : Math.abs(
                        Number(value) - Number(state.slots[i].seed),
                      ) >
                      (state.slots[i].step ?? 0.001) / 2,
            });
          }}
          onRename={(slotId, name) => updateSlot(slotId, { name })}
          onResetToSeed={(slotId) => {
            const i = findIdx(slotId);
            if (i < 0) return;
            updateSlot(slotId, {
              value: state.slots[i].seed,
              modified: false,
            });
          }}
          onUnmark={(slotId) => {
            setState(
              produce((s) => {
                s.slots = s.slots.filter((x) => x.id !== slotId);
              }),
            );
          }}
          onStartLearn={(slotId) => {
            setState("learnState", { mode: "single", slotId });
          }}
          onClearBinding={(slotId) => {
            setState(
              produce((s) => {
                s.bindings.delete(slotId);
                s.bindings = new Map(s.bindings);
              }),
            );
          }}
          onReorder={(newOrder) => {
            setState("order", { mode: "custom", custom: newOrder });
          }}
          onResetOrder={() => {
            setState("order", { mode: "document" });
          }}
          onClose={() => setClosed(true)}
        />
      )}
    </div>
  );
}

// ── Slot factories ────────────────────────────────────────────────────────

function numericSlot(
  id: string,
  name: string,
  value: number,
  opts: Partial<LiveEditSlot> = {},
): LiveEditSlot {
  return {
    id,
    kind: "numeric",
    name,
    seed: value,
    value,
    min: 0,
    max: 1,
    step: 0.01,
    precision: 2,
    state: "idle",
    range: { from: 0, to: 0 },
    modified: false,
    ...opts,
  };
}

function booleanSlot(
  id: string,
  name: string,
  value: boolean,
  opts: Partial<LiveEditSlot> = {},
): LiveEditSlot {
  return {
    id,
    kind: "boolean",
    name,
    seed: value,
    value,
    state: "idle",
    range: { from: 0, to: 0 },
    modified: false,
    ...opts,
  };
}

function keywordSlot(
  id: string,
  name: string,
  value: string,
  options: string[],
  opts: Partial<LiveEditSlot> = {},
): LiveEditSlot {
  return {
    id,
    kind: "keyword",
    name,
    seed: value,
    value,
    options,
    state: "idle",
    range: { from: 0, to: 0 },
    modified: false,
    ...opts,
  };
}

// ── Meta ──────────────────────────────────────────────────────────────────

const meta: Meta = {
  title: "LiveEdit/Panel",
  tags: ["autodocs"],
  parameters: { layout: "padded" },
  component: PanelHarness,
};
export default meta;
type Story = StoryObj;

// ── Stories ───────────────────────────────────────────────────────────────

/** No live-edits in the document — empty-state hint visible. */
export const Empty: Story = {
  render: () => <PanelHarness initialSlots={[]} />,
};

/** Single numeric live-edit, default state. */
export const SingleNumeric: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[numericSlot("a1b2", "cutoff", 0.6, { min: 0, max: 1 })]}
    />
  ),
};

/** Single boolean toggle. */
export const SingleBoolean: Story = {
  render: () => (
    <PanelHarness initialSlots={[booleanSlot("kx7q", "mute", false)]} />
  ),
};

/** A mixed, longer list to exercise scrolling and the various widget kinds. */
export const MixedKindsManyCards: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.74, { min: 0, max: 1, modified: true }),
        numericSlot("c3d4", "resonance", 0.3, { min: 0, max: 1 }),
        booleanSlot("kx7q", "mute", false),
        keywordSlot("e5f6", "envelope", "decay", [
          "attack",
          "decay",
          "sustain",
          "release",
        ]),
        numericSlot("g7h8", "rate", 8, {
          min: 1,
          max: 16,
          step: 1,
          precision: 0,
        }),
        numericSlot("nx9p", "drive", 1.4, { min: 0, max: 4, precision: 2 }),
        booleanSlot("rt22", "loop", true, { modified: true }),
        keywordSlot("u4vv", "wave", "saw", ["sine", "saw", "square", "tri"]),
      ]}
    />
  ),
};

/** Custom user-defined ordering plus the reset button. */
export const WithCustomOrder: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5),
        numericSlot("c3d4", "resonance", 0.3),
        booleanSlot("kx7q", "mute", false),
      ]}
      initialOrder={{ mode: "custom", custom: ["kx7q", "c3d4", "a1b2"] }}
    />
  ),
};

/** A single card is the active MIDI-learn target — pulse + banner visible. */
export const OneCardListening: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5),
        numericSlot("c3d4", "resonance", 0.3),
      ]}
      initialLearnState={{ mode: "single", slotId: "a1b2" }}
    />
  ),
};

/** A card with a confirmed MIDI binding shows a CC label and clear-binding affordance. */
export const OneCardWithBinding: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5),
        numericSlot("c3d4", "resonance", 0.3),
      ]}
      initialBindings={[
        {
          slotId: "a1b2",
          source: { kind: "cc", channel: 2, controller: 74 },
        },
      ]}
    />
  ),
};

/** A card whose wrapper failed compile validation — error badge + locked widget. */
export const OneCardError: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5, { state: "error" }),
        numericSlot("c3d4", "resonance", 0.3),
      ]}
    />
  ),
};

/** Cursor focus is on a card — shows the focused border halo. */
export const FocusedCard: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5),
        numericSlot("c3d4", "resonance", 0.3),
        booleanSlot("kx7q", "mute", false),
      ]}
      initialFocusedSlotId="c3d4"
    />
  ),
};

/** Batch learn mode — banner shows progress (3/5) and the third card pulses. */
export const BatchLearning: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5),
        numericSlot("c3d4", "resonance", 0.3),
        numericSlot("e5f6", "drive", 1),
        booleanSlot("kx7q", "mute", false),
        keywordSlot("u4vv", "wave", "saw", ["sine", "saw", "square", "tri"]),
      ]}
      initialLearnState={{
        mode: "batch",
        slotIds: ["a1b2", "c3d4", "e5f6", "kx7q", "u4vv"],
        index: 2,
      }}
    />
  ),
};

/** A wasm-preview card — dashed border + badge per §6.5. */
export const WasmPreviewCard: Story = {
  render: () => (
    <PanelHarness
      initialSlots={[
        numericSlot("a1b2", "cutoff", 0.5, { state: "wasm-preview" }),
        numericSlot("c3d4", "resonance", 0.3),
      ]}
    />
  ),
};
