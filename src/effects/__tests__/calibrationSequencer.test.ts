// src/effects/__tests__/calibrationSequencer.test.ts
//
// Unit tests for the calibration sequencer state machine.
// Spec: docs/specs/calibration.md
//
// All firmware interaction is mocked via CalibrationTransport.
// Tests cover: happy path, abort path, firmware rejection, disconnect,
// resume from partial, skip, carry-forward offset, chaining to next output.

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createCalibrationSequencer,
  type CalibrationSequencer,
  type CalibrationTransport,
  type SequencerState,
} from "../calibrationSequencer";
import type {
  CalibrationOctaveIndex,
  CalibrationOutput,
} from "../../contracts/hardware";

// ── Mock transport factory ───────────────────────────────────────────────────

function mockTransport(
  overrides: Partial<CalibrationTransport> = {},
): CalibrationTransport {
  return {
    calibrateBegin: vi.fn().mockResolvedValue(undefined),
    calibrateSetTarget: vi.fn().mockResolvedValue(undefined),
    calibrateAdjust: vi.fn().mockResolvedValue(undefined),
    calibrateSavePoint: vi.fn().mockResolvedValue(undefined),
    calibrateEnd: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

// ── Test fixtures ────────────────────────────────────────────────────────────

const OUTPUTS: CalibrationOutput[] = [
  { id: "a1", status: { kind: "uncalibrated" } },
  { id: "a2", status: { kind: "calibrated", date: "2026-04-30" } },
  { id: "a3", status: { kind: "partial", savedOctaves: [0, 1] } },
  { id: "a4", status: { kind: "uncalibrated" } },
];

// ── Idle state ───────────────────────────────────────────────────────────────

describe("idle state", () => {
  it("starts in idle with no session", () => {
    const seq = createCalibrationSequencer(mockTransport());
    expect(seq.state.phase).toBe("idle");
    expect(seq.state.session).toBeNull();
    expect(seq.state.outputs).toEqual([]);
  });
});

// ── Picking state ────────────────────────────────────────────────────────────

describe("picking state", () => {
  let seq: CalibrationSequencer;
  let transport: CalibrationTransport;

  beforeEach(() => {
    transport = mockTransport();
    seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
  });

  it("transitions to picking with outputs", () => {
    expect(seq.state.phase).toBe("picking");
    expect(seq.state.outputs).toEqual(OUTPUTS);
    expect(seq.state.session).toBeNull();
  });

  it("cancelPicker returns to idle", () => {
    seq.cancelPicker();
    expect(seq.state.phase).toBe("idle");
    expect(seq.state.outputs).toEqual([]);
  });

  it("pickOutput sends calibrate-begin and set-target", async () => {
    await seq.pickOutput("a1", "fresh");

    expect(transport.calibrateBegin).toHaveBeenCalledWith("a1");
    expect(transport.calibrateSetTarget).toHaveBeenCalledWith("a1", 0);
    expect(seq.state.phase).toBe("calibrating");
    expect(seq.state.session).not.toBeNull();
    expect(seq.state.session!.output).toBe("a1");
    expect(seq.state.session!.step).toBe(0);
    expect(seq.state.session!.offsetCents).toBe(0);
  });

  it("pickOutput with resume starts at the first unsaved octave", async () => {
    await seq.pickOutput("a3", "resume");

    expect(seq.state.session!.step).toBe(2); // 0 and 1 already saved
    expect(seq.state.session!.stepStatus[0]).toBe("saved");
    expect(seq.state.session!.stepStatus[1]).toBe("saved");
    expect(seq.state.session!.stepStatus[2]).toBe("pending");
    expect(transport.calibrateSetTarget).toHaveBeenCalledWith("a3", 2);
  });

  it("pickOutput with restart always starts at 0", async () => {
    await seq.pickOutput("a3", "restart");

    expect(seq.state.session!.step).toBe(0);
    expect(seq.state.session!.stepStatus[0]).toBe("pending");
    expect(transport.calibrateSetTarget).toHaveBeenCalledWith("a3", 0);
  });

  it("shows inline error on calibrate-begin rejection (??7.1)", async () => {
    const rejectTransport = mockTransport({
      calibrateBegin: vi.fn().mockRejectedValue(new Error("output busy")),
    });
    const s = createCalibrationSequencer(rejectTransport);
    s.openPicker(OUTPUTS);

    await s.pickOutput("a1", "fresh");

    expect(s.state.phase).toBe("picking"); // stays on picker
    expect(s.state.pickerError).toContain("a1 calibration unavailable");
    expect(s.state.pickerError).toContain("output busy");
    expect(s.state.session).toBeNull();
  });
});

// ── Happy path: full calibration ─────────────────────────────────────────────

describe("happy path -- full calibration of one output", () => {
  let seq: CalibrationSequencer;
  let transport: CalibrationTransport;

  beforeEach(async () => {
    transport = mockTransport();
    seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");
  });

  it("walks through all 5 octaves saving each", async () => {
    // We're at step 0. Save and advance through all steps.
    for (let i = 0; i < 4; i++) {
      expect(seq.state.session!.step).toBe(i as CalibrationOctaveIndex);
      await seq.saveAndNext();
      expect(seq.state.session!.stepStatus[i as CalibrationOctaveIndex]).toBe(
        "saved",
      );
    }

    // At step 4 -- last step.
    expect(seq.state.session!.step).toBe(4);
    await seq.saveAndNext();

    // Should be complete now.
    expect(seq.state.phase).toBe("complete");
    expect(seq.state.session!.complete).toBe(true);
    expect(transport.calibrateEnd).toHaveBeenCalledWith(true);
    expect(transport.calibrateSavePoint).toHaveBeenCalledTimes(5);
  });

  it("sends calibrate-set-target for each advancing step", async () => {
    await seq.saveAndNext(); // step 0 -> step 1
    expect(transport.calibrateSetTarget).toHaveBeenCalledWith("a1", 1);

    await seq.saveAndNext(); // step 1 -> step 2
    expect(transport.calibrateSetTarget).toHaveBeenCalledWith("a1", 2);
  });

  it("carries forward offset on save (??4.3)", async () => {
    // Adjust offset, then save.
    await seq.adjust(5.5);
    expect(seq.state.session!.offsetCents).toBeCloseTo(5.5);

    await seq.saveAndNext();
    // Next step should carry the offset forward.
    expect(seq.state.session!.offsetCents).toBeCloseTo(5.5);
  });
});

// ── carryForwardOffset gate (§9.7) ─────────────────────────────────────────────

describe("carryForwardOffset setting (§9.7)", () => {
  it("starts the next octave at zero when carryForwardOffset is false", async () => {
    const transport = mockTransport();
    const seq = createCalibrationSequencer(transport, {
      carryForwardOffset: false,
    });
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    await seq.adjust(5.5);
    expect(seq.state.session!.offsetCents).toBeCloseTo(5.5);

    await seq.saveAndNext();
    // With carry-forward disabled the next octave resets to zero.
    expect(seq.state.session!.step).toBe(1);
    expect(seq.state.session!.offsetCents).toBe(0);
  });

  it("defaults to carrying the offset forward when no option is passed", async () => {
    const transport = mockTransport();
    const seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    await seq.adjust(3.2);
    await seq.saveAndNext();
    expect(seq.state.session!.offsetCents).toBeCloseTo(3.2);
  });
});

// ── Adjust ───────────────────────────────────────────────────────────────────

describe("adjust", () => {
  let seq: CalibrationSequencer;
  let transport: CalibrationTransport;

  beforeEach(async () => {
    transport = mockTransport();
    seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");
  });

  it("accumulates delta on adjust", async () => {
    await seq.adjust(3.0);
    expect(seq.state.session!.offsetCents).toBeCloseTo(3.0);

    await seq.adjust(-1.0);
    expect(seq.state.session!.offsetCents).toBeCloseTo(2.0);
  });

  it("sends calibrate-adjust to transport", async () => {
    await seq.adjust(2.5);
    expect(transport.calibrateAdjust).toHaveBeenCalledWith("a1", 2.5);
  });

  it("snaps to firmware authoritative value when clamped (??4.5)", async () => {
    const clampTransport = mockTransport({
      calibrateAdjust: vi.fn().mockResolvedValue(25.0), // firmware clamped to 25
    });
    const s = createCalibrationSequencer(clampTransport);
    s.openPicker(OUTPUTS);
    await s.pickOutput("a1", "fresh");

    await s.adjust(100.0); // request 100 cents, firmware clamps to 25
    expect(s.state.session!.offsetCents).toBe(25.0);
  });

  it("is a no-op when not in calibrating phase", async () => {
    seq.cancelPicker(); // This won't work because we're in calibrating...
    // Instead, let's go to idle via disconnect.
    seq.handleDisconnect();
    expect(seq.state.phase).toBe("idle");

    await seq.adjust(5.0);
    // Should not throw, and session should still be null.
    expect(seq.state.session).toBeNull();
  });
});

// ── Skip ─────────────────────────────────────────────────────────────────────

describe("skip", () => {
  let seq: CalibrationSequencer;
  let transport: CalibrationTransport;

  beforeEach(async () => {
    transport = mockTransport();
    seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");
  });

  it("marks step as skipped and advances (??5.3)", async () => {
    await seq.skip();

    expect(seq.state.session!.stepStatus[0]).toBe("skipped");
    expect(seq.state.session!.step).toBe(1);
    expect(seq.state.phase).toBe("calibrating");
  });

  it("does not send calibrate-save-point", async () => {
    await seq.skip();
    expect(transport.calibrateSavePoint).not.toHaveBeenCalled();
  });

  it("does not carry forward offset on skip", async () => {
    await seq.adjust(10.0);
    await seq.skip();
    // Offset resets to 0 on skip (unlike save which carries forward).
    expect(seq.state.session!.offsetCents).toBe(0);
  });

  it("completes after skipping all 5 steps", async () => {
    for (let i = 0; i < 5; i++) {
      await seq.skip();
    }
    expect(seq.state.phase).toBe("complete");
    expect(transport.calibrateEnd).toHaveBeenCalledWith(true);
  });
});

// ── Abort path ───────────────────────────────────────────────────────────────

describe("abort", () => {
  let seq: CalibrationSequencer;
  let transport: CalibrationTransport;

  beforeEach(async () => {
    transport = mockTransport();
    seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");
  });

  it("requestAbort sets abortConfirm=true", () => {
    seq.requestAbort();
    expect(seq.state.session!.abortConfirm).toBe(true);
    expect(seq.state.phase).toBe("calibrating"); // stays in calibrating
  });

  it("confirmAbort(false) clears the abort confirm", async () => {
    seq.requestAbort();
    await seq.confirmAbort(false);
    expect(seq.state.session!.abortConfirm).toBe(false);
    expect(seq.state.phase).toBe("calibrating");
  });

  it("confirmAbort(true) sends calibrate-end{commit:false} and returns to idle", async () => {
    seq.requestAbort();
    await seq.confirmAbort(true);

    expect(transport.calibrateEnd).toHaveBeenCalledWith(false);
    expect(seq.state.phase).toBe("idle");
    expect(seq.state.session).toBeNull();
  });

  it("confirmAbort(true) transitions to idle even if calibrate-end fails", async () => {
    const failEndTransport = mockTransport({
      calibrateEnd: vi.fn().mockRejectedValue(new Error("cable gone")),
    });
    const s = createCalibrationSequencer(failEndTransport);
    s.openPicker(OUTPUTS);
    await s.pickOutput("a1", "fresh");

    s.requestAbort();
    await s.confirmAbort(true);

    // Should still go to idle -- best effort.
    expect(s.state.phase).toBe("idle");
  });

  it("abort after saving some points still works (??6.2)", async () => {
    await seq.saveAndNext(); // save step 0
    await seq.saveAndNext(); // save step 1

    seq.requestAbort();
    await seq.confirmAbort(true);

    expect(transport.calibrateEnd).toHaveBeenCalledWith(false);
    expect(seq.state.phase).toBe("idle");
  });
});

// ── Firmware rejection mid-takeover ──────────────────────────────────────────

describe("firmware rejection mid-takeover (??7.2)", () => {
  it("save-point rejection transitions to error phase", async () => {
    const failSaveTransport = mockTransport({
      calibrateSavePoint: vi
        .fn()
        .mockRejectedValue(new Error("flash write failed")),
    });
    const seq = createCalibrationSequencer(failSaveTransport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    await seq.saveAndNext();

    expect(seq.state.phase).toBe("error");
    expect(seq.state.session!.error).toContain("flash write failed");
    expect(seq.state.session!.saving).toBe(false);
    expect(seq.state.session!.step).toBe(0); // stays on same step
  });

  it("retrySave re-issues save-point and succeeds", async () => {
    let callCount = 0;
    const sometimesFail = mockTransport({
      calibrateSavePoint: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new Error("flash busy"));
        }
        return Promise.resolve();
      }),
    });
    const seq = createCalibrationSequencer(sometimesFail);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    // First save fails.
    await seq.saveAndNext();
    expect(seq.state.phase).toBe("error");

    // Retry succeeds.
    await seq.retrySave();
    expect(seq.state.phase).toBe("calibrating");
    expect(seq.state.session!.step).toBe(1); // advanced to next step
    expect(seq.state.session!.stepStatus[0]).toBe("saved");
  });

  it("set-target rejection after begin shows error", async () => {
    const failTargetTransport = mockTransport({
      calibrateSetTarget: vi
        .fn()
        .mockRejectedValue(new Error("output not exposed")),
    });
    const seq = createCalibrationSequencer(failTargetTransport);
    seq.openPicker(OUTPUTS);

    await seq.pickOutput("a1", "fresh");

    expect(seq.state.phase).toBe("error");
    expect(seq.state.lastError).toContain("output not exposed");
  });

  it("calibrate-end rejection during completion surfaces error", async () => {
    const failEndTransport = mockTransport({
      calibrateEnd: vi
        .fn()
        .mockRejectedValue(new Error("flash commit failed")),
    });
    const seq = createCalibrationSequencer(failEndTransport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    // Walk through all 5 steps.
    for (let i = 0; i < 5; i++) {
      await seq.saveAndNext();
    }

    // The last saveAndNext tries calibrate-end(true) which fails.
    expect(seq.state.phase).toBe("error");
    expect(seq.state.lastError).toContain("flash commit failed");
  });
});

// ── Disconnect mid-takeover ──────────────────────────────────────────────────

describe("disconnect mid-takeover (??6.4)", () => {
  it("resets to idle on disconnect during calibrating", async () => {
    const seq = createCalibrationSequencer(mockTransport());
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    expect(seq.state.phase).toBe("calibrating");

    seq.handleDisconnect();
    expect(seq.state.phase).toBe("idle");
    expect(seq.state.session).toBeNull();
  });

  it("resets to idle on disconnect during picking", () => {
    const seq = createCalibrationSequencer(mockTransport());
    seq.openPicker(OUTPUTS);

    seq.handleDisconnect();
    expect(seq.state.phase).toBe("idle");
  });
});

// ── Chain to next output (??5.4) ─────────────────────────────────────────────

describe("chain to next output (??5.4)", () => {
  let seq: CalibrationSequencer;
  let transport: CalibrationTransport;

  beforeEach(async () => {
    transport = mockTransport();
    seq = createCalibrationSequencer(transport);
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    // Complete all 5 steps.
    for (let i = 0; i < 5; i++) {
      await seq.saveAndNext();
    }
    expect(seq.state.phase).toBe("complete");
  });

  it("requestNextOutput(null) exits to idle", async () => {
    await seq.requestNextOutput(null);
    expect(seq.state.phase).toBe("idle");
  });

  it("requestNextOutput with output id starts fresh calibration", async () => {
    await seq.requestNextOutput("a2");

    expect(seq.state.phase).toBe("calibrating");
    expect(seq.state.session!.output).toBe("a2");
    expect(seq.state.session!.step).toBe(0);
    expect(transport.calibrateBegin).toHaveBeenCalledWith("a2");
  });
});

// ── State change listener ────────────────────────────────────────────────────

describe("state change listener", () => {
  it("fires on every state transition", async () => {
    const transport = mockTransport();
    const seq = createCalibrationSequencer(transport);
    const states: SequencerState[] = [];

    seq.onStateChanged((s) => states.push({ ...s }));

    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    // At minimum: picking, calibrating (and possibly saving intermediates).
    expect(states.length).toBeGreaterThanOrEqual(2);
    expect(states[0].phase).toBe("picking");
  });

  it("unsubscribe stops notifications", () => {
    const seq = createCalibrationSequencer(mockTransport());
    const states: SequencerState[] = [];

    const unsub = seq.onStateChanged((s) => states.push({ ...s }));
    seq.openPicker(OUTPUTS);
    expect(states.length).toBe(1);

    unsub();
    seq.cancelPicker();
    expect(states.length).toBe(1); // no new notification
  });
});

// ── Edge cases ───────────────────────────────────────────────────────────────

describe("edge cases", () => {
  it("pickOutput is no-op when not in picking phase", async () => {
    const seq = createCalibrationSequencer(mockTransport());
    // Still idle -- not picking.
    await seq.pickOutput("a1", "fresh");
    expect(seq.state.phase).toBe("idle");
  });

  it("saveAndNext is no-op when not calibrating or error", async () => {
    const seq = createCalibrationSequencer(mockTransport());
    // Still idle.
    await seq.saveAndNext();
    expect(seq.state.phase).toBe("idle");
  });

  it("skip is no-op when not calibrating", async () => {
    const seq = createCalibrationSequencer(mockTransport());
    await seq.skip();
    expect(seq.state.phase).toBe("idle");
  });

  it("requestAbort is no-op when not calibrating", () => {
    const seq = createCalibrationSequencer(mockTransport());
    seq.requestAbort();
    expect(seq.state.phase).toBe("idle");
  });

  it("mixed save and skip steps produce correct status", async () => {
    const seq = createCalibrationSequencer(mockTransport());
    seq.openPicker(OUTPUTS);
    await seq.pickOutput("a1", "fresh");

    await seq.saveAndNext(); // step 0 -> saved
    await seq.skip(); // step 1 -> skipped
    await seq.saveAndNext(); // step 2 -> saved
    await seq.skip(); // step 3 -> skipped
    await seq.saveAndNext(); // step 4 -> saved -> complete

    expect(seq.state.session!.stepStatus).toEqual({
      0: "saved",
      1: "skipped",
      2: "saved",
      3: "skipped",
      4: "saved",
    });
    expect(seq.state.phase).toBe("complete");
  });
});
