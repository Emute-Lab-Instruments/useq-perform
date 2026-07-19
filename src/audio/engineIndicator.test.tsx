/**
 * Inspector-style component tests for the synthesis engine indicator.
 *
 * Covers (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-ENGINE-021 — all four engine states render through props in the
 *                    transport-indicator family without importing runtime
 *                    singletons. The component imports NOTHING from
 *                    src/runtime/ or src/effects/; only the contract types.
 *
 * These tests were OBSERVED FAILING before the indicator module was added
 * (the imports did not resolve). They pass after the component is in place.
 */
import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, expect, it, vi } from "vitest";

import {
  EngineIndicator,
  engineIndicatorAriaLabel,
  engineIndicatorClass,
  engineIndicatorLabel,
} from "./engineIndicator";
import type { EngineStateSnapshot, SynthesisEngineState } from "../contracts/synthesisChannels";

function snapshot(
  state: SynthesisEngineState,
  overrides?: Partial<EngineStateSnapshot>,
): EngineStateSnapshot {
  return {
    state,
    reasonKey: null,
    reasonMessage: null,
    transitionCount: 1,
    transitionedAt: 0,
    ...overrides,
  };
}

describe("engineIndicator — pure helpers", () => {
  it("engineIndicatorClass returns a stable class per state", () => {
    expect(engineIndicatorClass("off")).toBe("engine-indicator-off");
    expect(engineIndicatorClass("suspended")).toBe("engine-indicator-suspended");
    expect(engineIndicatorClass("running")).toBe("engine-indicator-running");
    expect(engineIndicatorClass("error")).toBe("engine-indicator-error");
  });

  it("engineIndicatorLabel returns a short label per state", () => {
    expect(engineIndicatorLabel("off")).toBe("Audio off");
    expect(engineIndicatorLabel("suspended")).toBe("Suspended");
    expect(engineIndicatorLabel("running")).toBe("Running");
    expect(engineIndicatorLabel("error")).toBe("Error");
  });

  it("engineIndicatorAriaLabel returns an accessible label per state", () => {
    for (const s of ["off", "suspended", "running", "error"] as const) {
      expect(engineIndicatorAriaLabel(s).length).toBeGreaterThan(0);
    }
    expect(engineIndicatorAriaLabel("suspended")).toMatch(/click/i);
  });
});

describe("engineIndicator — VAL-ENGINE-021: props-based rendering", () => {
  it("renders a clickable suspended indicator with the recovery affordance", () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snapshot("suspended")} onResume={onResume} />
    ));

    const el = container.querySelector(".engine-indicator");
    expect(el).not.toBeNull();
    expect(el?.classList.contains("engine-indicator-suspended")).toBe(true);
    expect(el?.classList.contains("engine-indicator-clickable")).toBe(true);
    expect(el?.getAttribute("data-engine-state")).toBe("suspended");
    expect(el?.getAttribute("aria-pressed")).toBe("false");
  });

  it("renders the running indicator as non-clickable with aria-pressed=true", () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snapshot("running")} onResume={onResume} />
    ));

    const el = container.querySelector(".engine-indicator");
    expect(el?.classList.contains("engine-indicator-running")).toBe(true);
    expect(el?.classList.contains("engine-indicator-disabled")).toBe(true);
    expect(el?.getAttribute("aria-pressed")).toBe("true");
  });

  it("renders the error indicator as clickable", () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator
        state={snapshot("error", { reasonMessage: "Producer timed out" })}
        onResume={onResume}
      />
    ));

    const el = container.querySelector(".engine-indicator");
    expect(el?.classList.contains("engine-indicator-error")).toBe(true);
    expect(el?.classList.contains("engine-indicator-clickable")).toBe(true);
    expect(el?.getAttribute("title")).toBe("Producer timed out");
  });

  it("renders nothing when capability is absent", () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator
        state={snapshot("off", { reasonKey: "NO_AUDIO_CAPABILITY" })}
        onResume={onResume}
      />
    ));

    // Capability case is delivered via the compiler diagnostic channel;
    // the indicator surface stays empty.
    const el = container.querySelector(".engine-indicator");
    expect(el).toBeNull();
  });

  it("renders the plain off state when capability is present but not activated", () => {
    // When audio is capable but the user has not yet brought up the
    // engine, the indicator shows 'off' as a non-clickable affordance.
    // (The bootstrap wiring can hide it via CSS; the component itself
    // renders the chip so devmode/telemetry tests can assert presence.)
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snapshot("off")} onResume={onResume} />
    ));

    const el = container.querySelector(".engine-indicator");
    expect(el?.classList.contains("engine-indicator-off")).toBe(true);
    expect(el?.classList.contains("engine-indicator-disabled")).toBe(true);
  });

  it("onResume is invoked on trusted click in suspended/error state", async () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snapshot("suspended")} onResume={onResume} />
    ));

    const el = container.querySelector(".engine-indicator") as HTMLButtonElement;
    el.click();
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("onResume is NOT invoked in the running state", async () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snapshot("running")} onResume={onResume} />
    ));

    const el = container.querySelector(".engine-indicator") as HTMLButtonElement;
    el.click();
    expect(onResume).not.toHaveBeenCalled();
  });

  it("data-transition-count reflects the latest snapshot", () => {
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator
        state={snapshot("running", { transitionCount: 7 })}
        onResume={onResume}
      />
    ));

    const el = container.querySelector(".engine-indicator");
    expect(el?.getAttribute("data-transition-count")).toBe("7");
  });
});

describe("engineIndicator — VAL-ENGINE-021: reactive class updates", () => {
  // Regression coverage for Ergo bug 0bb65c33. The indicator previously
  // combined a static `class` template-literal expression with a separate
  // `classList` directive on the same button. When `props.state.state`
  // changed, SolidJS reconciled the `class` attribute from the template
  // literal first; that reconciliation reset the DOM classList, and the
  // `classList` directive's reactive effect did not re-apply entries
  // whose boolean value had not changed since the previous render
  // (e.g. error -> suspended, both clickable). The user-visible result
  // was an indicator whose clickable/disabled CSS classes went stale on
  // certain state transitions, even though data-engine-state, tooltip,
  // aria-pressed, and the click handler were already correct.
  //
  // These tests drive the indicator from a parent-owned Solid signal
  // (mirroring the production adapter) and assert, after every
  // transition in a real transition sequence, that the clickable /
  // disabled CSS classes match the current snapshot state.
  function makeSnap(
    state: SynthesisEngineState,
    overrides: Partial<EngineStateSnapshot> = {},
  ): EngineStateSnapshot {
    return {
      state,
      reasonKey: null,
      reasonMessage: null,
      transitionCount: 1,
      transitionedAt: 0,
      ...overrides,
    };
  }

  it("preserves engine-indicator-clickable on error -> suspended transition", () => {
    const [snap, setSnap] = createSignal<EngineStateSnapshot>(
      makeSnap("suspended"),
    );
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snap()} onResume={onResume} />
    ));

    const el = () => container.querySelector(".engine-indicator") as HTMLButtonElement;

    // Start in suspended (clickable).
    expect(el().classList.contains("engine-indicator-suspended")).toBe(true);
    expect(el().classList.contains("engine-indicator-clickable")).toBe(true);

    // Transition to running (disabled).
    setSnap(makeSnap("running"));
    expect(el().classList.contains("engine-indicator-running")).toBe(true);
    expect(el().classList.contains("engine-indicator-disabled")).toBe(true);
    expect(el().classList.contains("engine-indicator-clickable")).toBe(false);

    // Transition to error (clickable again).
    setSnap(makeSnap("error", { reasonMessage: "Producer timed out" }));
    expect(el().classList.contains("engine-indicator-error")).toBe(true);
    expect(el().classList.contains("engine-indicator-clickable")).toBe(true);
    expect(el().classList.contains("engine-indicator-disabled")).toBe(false);

    // The bug: error -> suspended kept clickable=true in the classList
    // directive, but the template-literal `class` update reset the DOM
    // classList and the directive did not re-add the class. The user
    // saw an indicator that no longer looked clickable.
    setSnap(makeSnap("suspended"));
    expect(el().classList.contains("engine-indicator-suspended")).toBe(true);
    expect(
      el().classList.contains("engine-indicator-clickable"),
      "clickable class must remain present after error -> suspended",
    ).toBe(true);
    expect(el().classList.contains("engine-indicator-disabled")).toBe(false);
  });

  it("cyclically transitions through all four states without stale classes", () => {
    const [snap, setSnap] = createSignal<EngineStateSnapshot>(makeSnap("off"));
    const onResume = vi.fn();
    const { container } = render(() => (
      <EngineIndicator state={snap()} onResume={onResume} />
    ));

    const el = () => container.querySelector(".engine-indicator") as HTMLButtonElement;
    const allStates: SynthesisEngineState[] = ["off", "suspended", "running", "error"];
    const seq: SynthesisEngineState[] = [
      "off", "suspended", "running", "error",
      "suspended", "running", "off", "error",
      "running", "suspended", "off", "running",
      "error", "suspended", "running", "off",
    ];

    for (const current of seq) {
      setSnap(makeSnap(current));
      const classes = el().classList;
      const clickable = current === "suspended" || current === "error";

      // The state-specific class is always correct.
      expect(
        classes.contains(`engine-indicator-${current}`),
        `state ${current}: missing state class`,
      ).toBe(true);
      // No stale state classes from the previous render.
      for (const other of allStates) {
        if (other === current) continue;
        expect(
          classes.contains(`engine-indicator-${other}`),
          `state ${current}: stale state class engine-indicator-${other}`,
        ).toBe(false);
      }
      // The reactive classList entries match the current state.
      expect(
        classes.contains("engine-indicator-clickable"),
        `state ${current}: clickable class stale`,
      ).toBe(clickable);
      expect(
        classes.contains("engine-indicator-disabled"),
        `state ${current}: disabled class stale`,
      ).toBe(!clickable);
    }
  });

  it("reactively updates aria-pressed, tooltip, data-state, and click handling", () => {
    const onResume = vi.fn();
    const [snap, setSnap] = createSignal<EngineStateSnapshot>(
      makeSnap("suspended", {
        reasonMessage: "click to resume",
      }),
    );
    const { container } = render(() => (
      <EngineIndicator state={snap()} onResume={onResume} />
    ));

    const el = () => container.querySelector(".engine-indicator") as HTMLButtonElement;

    // Suspended: clickable, tooltip from reason, aria-pressed false.
    expect(el().getAttribute("data-engine-state")).toBe("suspended");
    expect(el().getAttribute("title")).toBe("click to resume");
    expect(el().getAttribute("aria-pressed")).toBe("false");
    expect(el().disabled).toBe(false);
    el().click();
    expect(onResume).toHaveBeenCalledTimes(1);

    // Running: aria-pressed true, click suppressed.
    setSnap(makeSnap("running"));
    expect(el().getAttribute("data-engine-state")).toBe("running");
    expect(el().getAttribute("aria-pressed")).toBe("true");
    expect(el().disabled).toBe(true);
    el().click();
    expect(onResume).toHaveBeenCalledTimes(1);

    // Error: tooltip from reason, clickable.
    setSnap(makeSnap("error", { reasonMessage: "Producer timed out" }));
    expect(el().getAttribute("data-engine-state")).toBe("error");
    expect(el().getAttribute("title")).toBe("Producer timed out");
    expect(el().getAttribute("aria-pressed")).toBe("false");
    expect(el().disabled).toBe(false);
    el().click();
    expect(onResume).toHaveBeenCalledTimes(2);
  });
});

describe("engineIndicator — import boundary", () => {
  it("does NOT import anything from src/runtime/ or src/effects/", async () => {
    // Read the source file and assert no forbidden imports. This is the
    // static architecture contract for VAL-ENGINE-021: the indicator is
    // a pure view and must not pull runtime singletons.
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.resolve(import.meta.dirname, "engineIndicator.tsx"),
      "utf8",
    );
    // The only allowed import from src/ is the typed contract module.
    expect(source).toMatch(/from ["']\.\.\/contracts\/synthesisChannels["']/);
    expect(source).not.toMatch(/from ["']\.\.\/runtime\//);
    expect(source).not.toMatch(/from ["']\.\.\/effects\//);
    expect(source).not.toMatch(/from ["']\.\.\/audio\/synthesisService/);
  });
});
