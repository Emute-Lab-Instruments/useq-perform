// stories/calibration/calibration.stories.tsx
//
// Storybook stories for the CV calibration takeover and picker.
// Spec: docs/specs/calibration.md.

import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { createStore } from "solid-js/store";
import { CalibrationPicker } from "@src/ui/calibration/CalibrationPicker";
import { CalibrationTakeover } from "@src/ui/calibration/CalibrationTakeover";
import { CalibrationCompleteBanner } from "@src/ui/calibration/CalibrationCompleteBanner";
import type {
  CalibrationOctaveIndex,
  CalibrationOutput,
  CalibrationSession,
  CalibrationStepStatus,
} from "@src/contracts/hardware";
import "@src/ui/calibration/CalibrationTakeover.css";

// ── Stub backdrop ───────────────────────────────────────────────────
//
// Per the bead instructions: do *not* try to dim a real editor — render
// a stub backdrop behind the takeover instead, with the spec-mandated
// 30 % opacity (§3.1).

function StubEditorBackdrop() {
  const placeholder =
    `(define a1 (sin (* 4 (now))))\n` +
    `(define a2 (saw (* 2 (now))))\n` +
    `(define a3 (square (now)))\n` +
    `(define a4 (noise))\n\n` +
    `;; --- visualisation ---\n` +
    `(plot a1)\n(plot a2)\n(plot a3)\n(plot a4)\n`;
  return <div class="cal-stub-backdrop">{placeholder}</div>;
}

// ── Session helpers ─────────────────────────────────────────────────

function defaultStepStatus(): Record<
  CalibrationOctaveIndex,
  CalibrationStepStatus
> {
  return { 0: "pending", 1: "pending", 2: "pending", 3: "pending", 4: "pending" };
}

function makeSession(overrides: Partial<CalibrationSession> = {}): CalibrationSession {
  return {
    output: "a1",
    step: 0,
    offsetCents: 0,
    stepStatus: defaultStepStatus(),
    saving: false,
    abortConfirm: false,
    complete: false,
    ...overrides,
  };
}

const SAMPLE_NEXT_OUTPUTS: CalibrationOutput[] = [
  { id: "a2", status: { kind: "uncalibrated" } },
  { id: "a3", status: { kind: "calibrated", date: "2026-04-30" } },
  { id: "a4", status: { kind: "uncalibrated" } },
];

// ── Live wrapper for the takeover ──────────────────────────────────

interface TakeoverWrapperProps {
  initial: CalibrationSession;
  nextOutputs?: CalibrationOutput[];
}

function TakeoverWrapper(props: TakeoverWrapperProps) {
  const [session, setSession] = createStore<CalibrationSession>(props.initial);
  return (
    <>
      <StubEditorBackdrop />
      <CalibrationTakeover
        session={session}
        nextOutputs={props.nextOutputs ?? SAMPLE_NEXT_OUTPUTS}
        onAdjust={(delta) => {
          setSession("offsetCents", (v) => {
            const next = v + delta;
            return Math.max(-50, Math.min(50, next));
          });
        }}
        onSaveAndNext={() => {
          // Visual-only stub: mark current saved, advance step (or complete).
          setSession("saving", true);
          setTimeout(() => {
            setSession("stepStatus", session.step, "saved");
            setSession("saving", false);
            const next = session.step + 1;
            if (next > 4) {
              setSession("complete", true);
              return;
            }
            setSession("step", next as CalibrationOctaveIndex);
            setSession("offsetCents", 0);
          }, 250);
        }}
        onSkip={() => {
          setSession("stepStatus", session.step, "skipped");
          const next = session.step + 1;
          if (next > 4) {
            setSession("complete", true);
            return;
          }
          setSession("step", next as CalibrationOctaveIndex);
        }}
        onAbort={() => setSession("abortConfirm", true)}
        onAbortConfirm={(_discard) => {
          setSession("abortConfirm", false);
          // No real exit in stories; just clear confirm state.
        }}
        onRetrySave={() => setSession("error", undefined)}
        onRequestNextOutput={(_id) => {
          // Story stub: reset to fresh session.
          setSession({
            ...makeSession({ output: _id ?? session.output }),
          });
        }}
      />
    </>
  );
}

// ── Picker meta + stories ──────────────────────────────────────────

const pickerMeta: Meta = {
  title: "Calibration/Picker",
  tags: ["autodocs"],
};
export default pickerMeta;

type PickerStory = StoryObj;

export const Picker_AllUncalibrated: PickerStory = {
  render: () => (
    <CalibrationPicker
      outputs={[
        { id: "a1", status: { kind: "uncalibrated" } },
        { id: "a2", status: { kind: "uncalibrated" } },
        { id: "a3", status: { kind: "uncalibrated" } },
        { id: "a4", status: { kind: "uncalibrated" } },
      ]}
      onPick={() => {}}
      onCancel={() => {}}
    />
  ),
  parameters: {
    docs: { description: { story: "Fresh module — every output uncalibrated (§2.2)." } },
  },
};

export const Picker_Mixed: PickerStory = {
  render: () => (
    <CalibrationPicker
      outputs={[
        { id: "a1", status: { kind: "uncalibrated" } },
        { id: "a2", status: { kind: "calibrated", date: "2026-04-30" } },
        { id: "a3", status: { kind: "partial", savedOctaves: [0, 1] } },
        { id: "a4", status: { kind: "uncalibrated" } },
      ]}
      onPick={() => {}}
      onCancel={() => {}}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Mixed states — uncalibrated, calibrated-with-date, partial-resume (§2.2, §2.3).",
      },
    },
  },
};

export const Picker_PreflightError: PickerStory = {
  render: () => (
    <CalibrationPicker
      outputs={[
        { id: "a1", status: { kind: "uncalibrated" } },
        { id: "a2", status: { kind: "calibrated", date: "2026-04-30" } },
      ]}
      onPick={() => {}}
      onCancel={() => {}}
      pendingError="a1 calibration unavailable: takeover already active for a different output."
    />
  ),
  parameters: {
    docs: {
      description: {
        story: "Pre-flight rejection inline error (§7.1).",
      },
    },
  },
};

// ── Takeover stories ──────────────────────────────────────────────
//
// These re-use the same `pickerMeta` default export above. Storybook
// allows multiple title prefixes from a single file via per-story
// `parameters` — but the cleanest pattern is per-export titles. We use
// the picker meta as the default and override `title` per-takeover-story
// via the `title` field on the StoryObj.

const takeoverMeta = { title: "Calibration/Takeover" };

export const Step1_Idle: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <TakeoverWrapper initial={makeSession({ step: 0, offsetCents: 0 })} />
  ),
  parameters: {
    docs: {
      description: {
        story: "Step 1 of 5 — fresh entry, slider centred, ready to adjust.",
      },
    },
  },
};

export const Step3_MidTune: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <TakeoverWrapper
      initial={makeSession({
        step: 2,
        offsetCents: -3.4,
        stepStatus: {
          0: "saved",
          1: "saved",
          2: "pending",
          3: "pending",
          4: "pending",
        },
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story: "Step 3 of 5 — first two octaves saved, mid-tune at -3.4¢.",
      },
    },
  },
};

export const Step4_Saving: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <TakeoverWrapper
      initial={makeSession({
        step: 3,
        offsetCents: 1.2,
        saving: true,
        stepStatus: {
          0: "saved",
          1: "saved",
          2: "skipped",
          3: "pending",
          4: "pending",
        },
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Step 4 awaiting firmware ack on save-point send (saving=true, button disabled).",
      },
    },
  },
};

export const AbortConfirm: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <TakeoverWrapper
      initial={makeSession({
        step: 2,
        offsetCents: -2.1,
        abortConfirm: true,
        stepStatus: {
          0: "saved",
          1: "saved",
          2: "pending",
          3: "pending",
          4: "pending",
        },
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Abort confirm prompt inline (§6.2): 'Discard partial calibration?'",
      },
    },
  },
};

export const MidTakeoverError: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <TakeoverWrapper
      initial={makeSession({
        step: 2,
        offsetCents: 4.7,
        error: "flash write failed — the point was not saved.",
        stepStatus: {
          0: "saved",
          1: "saved",
          2: "pending",
          3: "pending",
          4: "pending",
        },
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Mid-takeover firmware rejection (§7.2): error block with Retry / Abort.",
      },
    },
  },
};

export const CompleteBanner: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <TakeoverWrapper
      initial={makeSession({
        step: 4,
        offsetCents: 0.4,
        complete: true,
        stepStatus: {
          0: "saved",
          1: "saved",
          2: "saved",
          3: "saved",
          4: "saved",
        },
      })}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Final completion banner (§5.4): 'Saved to flash ✓ — calibrate next output?'",
      },
    },
  },
};

// Standalone banner story (without the surrounding takeover) for visual review.
export const CompleteBanner_Standalone: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <div
      style={{
        padding: "60px",
        background: "#0e1014",
        "min-height": "100vh",
        display: "flex",
        "justify-content": "center",
      }}
    >
      <CalibrationCompleteBanner
        output="a1"
        nextOutputs={SAMPLE_NEXT_OUTPUTS}
        onRequestNextOutput={() => {}}
      />
    </div>
  ),
  parameters: {
    docs: {
      description: {
        story: "Bare CalibrationCompleteBanner component, isolated.",
      },
    },
  },
};

export const DisconnectBanner: PickerStory = {
  ...takeoverMeta,
  render: () => (
    <>
      <TakeoverWrapper
        initial={makeSession({
          step: 1,
          offsetCents: -0.6,
          stepStatus: {
            0: "saved",
            1: "pending",
            2: "pending",
            3: "pending",
            4: "pending",
          },
        })}
      />
      <div class="cal-disconnect-banner" role="status">
        Hardware disconnected — calibration aborted, prior settings preserved.
      </div>
    </>
  ),
  parameters: {
    docs: {
      description: {
        story:
          "Transient disconnect banner (§6.4) shown above the takeover; auto-dismisses after 4s in real flow.",
      },
    },
  },
};
