import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type {
  MidiBinding,
  MidiLearnState,
  MidiSource,
} from "@src/contracts/midi";
import { MidiLearnAffordance } from "@src/ui/liveEdit/MidiLearnAffordance";
import { MidiLearnBanner } from "@src/ui/liveEdit/MidiLearnBanner";
import { MidiLearnConflict } from "@src/ui/liveEdit/MidiLearnConflict";

// ─────────────────────────────────────────────────────────────────────────
// Shared fixtures
// ─────────────────────────────────────────────────────────────────────────

const ccCh2_74: MidiSource = { kind: "cc", channel: 2, controller: 74 };
const ccAny_14: MidiSource = { kind: "cc", channel: "any", controller: 14 };
const noteC3_velocity: MidiSource = {
  kind: "note",
  channel: 1,
  note: 60,
  mode: "velocity",
};

const ccBinding_Ch2_74: MidiBinding = {
  slotId: "cutoff",
  source: ccCh2_74,
};
const ccBinding_Any_14: MidiBinding = {
  slotId: "feedback",
  source: ccAny_14,
};
const noteBinding_C3: MidiBinding = {
  slotId: "trig",
  source: noteC3_velocity,
};

// Story container so the affordance has visible spacing.
function AffordanceFrame(props: { children: any }) {
  return (
    <div
      style={{
        padding: "16px",
        background: "var(--panel-bg-color, #1e1e2e)",
        "border-radius": "6px",
        display: "inline-flex",
        gap: "12px",
        "align-items": "center",
      }}
    >
      <span style={{ color: "var(--text-muted, #808098)", "font-size": "0.85rem" }}>
        cutoff
      </span>
      {props.children}
    </div>
  );
}

function BannerFrame(props: { children: any }) {
  return (
    <div
      style={{
        padding: "16px",
        background: "var(--panel-bg-color, #1e1e2e)",
        "border-radius": "6px",
        "min-width": "480px",
      }}
    >
      {props.children}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Affordance stories
// ─────────────────────────────────────────────────────────────────────────

const affordanceMeta: Meta = {
  title: "LiveEdit/MidiLearn",
  tags: ["autodocs"],
};
export default affordanceMeta;
type Story = StoryObj;

export const AffordanceIdle: Story = {
  render: () => (
    <AffordanceFrame>
      <MidiLearnAffordance
        slotId="cutoff"
        learning={false}
        onStart={() => {}}
        onCancel={() => {}}
        onClear={() => {}}
      />
    </AffordanceFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Idle state — no binding, not listening. The icon button is dim until hover. (§5.8.1)",
      },
    },
  },
};

export const AffordanceBoundCC: Story = {
  render: () => (
    <AffordanceFrame>
      <MidiLearnAffordance
        slotId="cutoff"
        binding={ccBinding_Ch2_74}
        learning={false}
        onStart={() => {}}
        onCancel={() => {}}
        onClear={() => {}}
      />
    </AffordanceFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Bound to a specific-channel CC. Label `Ch2 CC74` per §5.9.1. The `×` button clears the binding.",
      },
    },
  },
};

export const AffordanceBoundCCAnyChannel: Story = {
  render: () => (
    <AffordanceFrame>
      <MidiLearnAffordance
        slotId="feedback"
        binding={ccBinding_Any_14}
        learning={false}
        onStart={() => {}}
        onCancel={() => {}}
        onClear={() => {}}
      />
    </AffordanceFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Bound to an any-channel CC — label drops the `Ch_` prefix, just `CC14`.",
      },
    },
  },
};

export const AffordanceBoundNote: Story = {
  render: () => (
    <AffordanceFrame>
      <MidiLearnAffordance
        slotId="trig"
        binding={noteBinding_C3}
        learning={false}
        onStart={() => {}}
        onCancel={() => {}}
        onClear={() => {}}
      />
    </AffordanceFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Bound to a note in velocity mode — label `Ch1 C3 vel` per §5.9.1.",
      },
    },
  },
};

export const AffordanceListening: Story = {
  render: () => (
    <AffordanceFrame>
      <MidiLearnAffordance
        slotId="cutoff"
        learning={true}
        onStart={() => {}}
        onCancel={() => {}}
        onClear={() => {}}
      />
    </AffordanceFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Listening — pulsing 1Hz accent halo (§5.8.1). Clicking again cancels.",
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Banner stories
// ─────────────────────────────────────────────────────────────────────────

const idleState: MidiLearnState = { mode: "idle" };
const singleState: MidiLearnState = { mode: "single", slotId: "cutoff" };
const batchState: MidiLearnState = {
  mode: "batch",
  slotIds: ["cutoff", "res", "feedback", "delay", "rate", "depth", "drive", "mix"],
  index: 2,
};

export const BannerIdle: Story = {
  render: () => (
    <BannerFrame>
      <MidiLearnBanner
        state={idleState}
        onSkip={() => {}}
        onCancel={() => {}}
      />
      <p
        style={{
          color: "var(--text-muted, #808098)",
          "font-size": "0.8rem",
          "margin-top": "8px",
        }}
      >
        (Banner renders nothing in idle mode.)
      </p>
    </BannerFrame>
  ),
  parameters: {
    docs: {
      description: {
        story: "When `state.mode === 'idle'`, the banner does not render.",
      },
    },
  },
};

export const BannerSingle: Story = {
  render: () => (
    <BannerFrame>
      <MidiLearnBanner
        state={singleState}
        slotName="cutoff"
        onSkip={() => {}}
        onCancel={() => {}}
      />
    </BannerFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Single-mode learn banner (§5.8.1). Pulses gently to mirror the card's listening halo.",
      },
    },
  },
};

export const BannerBatchMidProgress: Story = {
  render: () => (
    <BannerFrame>
      <MidiLearnBanner
        state={batchState}
        batchSlotNames={[
          "cutoff",
          "res",
          "feedback",
          "delay",
          "rate",
          "depth",
          "drive",
          "mix",
        ]}
        onSkip={() => {}}
        onCancel={() => {}}
      />
    </BannerFrame>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Batch-mode learn banner showing slot 3 of 8. `N` skips, `Esc` cancels (§5.8.2).",
      },
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// Conflict modal
// ─────────────────────────────────────────────────────────────────────────

export const ConflictDialog: Story = {
  render: () => (
    <MidiLearnConflict
      incoming={ccCh2_74}
      existingBoundSlot={{ id: "cutoff", name: "cutoff" }}
      newSlot={{ id: "feedback", name: "feedback" }}
      onRebind={() => {}}
      onKeepExisting={() => {}}
      onCancel={() => {}}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Conflict modal shown when an incoming source matches an already-bound slot (§5.10). The default behaviour is to rebind; this dialog is the explicit-confirm variant.",
      },
    },
  },
};
