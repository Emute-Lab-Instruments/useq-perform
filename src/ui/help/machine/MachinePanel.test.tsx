/**
 * The Machine schematic — live-behaviour tests.
 *
 * Spec: docs/specs/the-machine.md §2.2 (four live behaviours, each from its
 * real source), §1.2 (honesty rule), §6.1 and §6.3 (acceptance).
 *
 * These drive the *real* stores, channels and transport machine — no mocks of
 * the app's own state. The only injected things are the two seams that would
 * otherwise require a booted WASM engine: the sample buffer (a real
 * `PastBuffer`, exactly what the sampler hands over) and the runtime-liveness
 * predicate.
 */

import { render, cleanup, fireEvent } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import { createActor } from "xstate";
import { reconcile } from "solid-js/store";

import { transportMachine } from "../../../machines/transport.machine";
import { codeEvaluated } from "../../../contracts/runtimeChannels";
import { PastBuffer } from "../../../lib/PastBuffer";
import {
  outputHealth,
  setOutputHealth,
  markOutputRunning,
  refreshOutputHealth,
} from "../../../utils/outputHealthStore";
import {
  updateBar,
  updateExpressions,
  updateTime,
} from "../../../utils/visualisationStore";
import { WiredMachinePanel } from "./MachinePanel";
import type { SampleWindow } from "./machineModel";

// ---------------------------------------------------------------------------
// Shared-store hygiene — these are module-global app stores.
// ---------------------------------------------------------------------------

function resetAppState() {
  updateExpressions({});
  updateTime(0);
  updateBar(0);
  setOutputHealth(reconcile({}));
  // refreshOutputHealth memoises on array identity; clear it with a fresh
  // empty array so the next test's diagnostics are not skipped.
  refreshOutputHealth([]);
  setOutputHealth(reconcile({}));
}

afterEach(() => {
  cleanup();
  resetAppState();
});

/** A real transport actor, started, with no orchestrator side effects. */
function startTransport() {
  const actor = createActor(transportMachine);
  actor.start();
  return actor;
}

function buffer(values: number[]): PastBuffer {
  const buf = new PastBuffer(Math.max(1, values.length));
  values.forEach((v, i) => buf.push(i * 0.01, v));
  return buf;
}

const noSamples = () => null as SampleWindow | null;

const flush = () => new Promise<void>((r) => queueMicrotask(() => r()));

// ---------------------------------------------------------------------------

describe("MachinePanel — quiescent state (§1.2, §6.3)", () => {
  it("renders visibly quiescent with no dead animation when no runtime is available", () => {
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => false, transportActor: null }}
      />
    ));

    const machine = getByTestId("machine");
    expect(machine.getAttribute("data-live")).toBe("false");
    expect(machine.classList.contains("machine--quiescent")).toBe(true);
    expect(getByTestId("machine-quiescent-note").textContent).toMatch(/runtime/i);
    // No rows, no jacks — nothing is claimed to be running.
    expect(getByTestId("machine-rows-empty")).toBeTruthy();
    expect(getByTestId("machine-jacks-empty")).toBeTruthy();
  });

  it("does not animate the program region on an eval while quiescent", async () => {
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => false, transportActor: null }}
      />
    ));

    codeEvaluated.publish({ code: "(a1 t)" });
    await flush();

    expect(
      getByTestId("machine-region-program").getAttribute("data-flashing"),
    ).toBe("false");
  });
});

describe("MachinePanel — §2.2 behaviour 1: transport drives the clock region", () => {
  it("follows the real transport machine through play / pause / stop", async () => {
    const actor = startTransport();
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: actor as never }}
      />
    ));

    // Machine boots paused (transport.md §1.1).
    expect(getByTestId("machine-clock-state").textContent).toBe("paused");

    actor.send({ type: "PLAY" });
    await flush();
    expect(getByTestId("machine-clock-state").textContent).toBe("playing");
    expect(getByTestId("machine-dial").getAttribute("data-clock-state")).toBe(
      "playing",
    );

    actor.send({ type: "PAUSE" });
    await flush();
    expect(getByTestId("machine-clock-state").textContent).toBe("paused");

    actor.send({ type: "STOP" });
    await flush();
    expect(getByTestId("machine-clock-state").textContent).toBe("stopped");

    actor.stop();
  });

  it("turns the clock hand only when the real bar phase moves", async () => {
    const actor = startTransport();
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: actor as never }}
      />
    ));

    const hand = () => getByTestId("machine-dial-hand").getAttribute("transform");
    const initial = hand();

    // No event -> no movement. This is the honesty rule as an assertion.
    await flush();
    expect(hand()).toBe(initial);

    updateBar(0.25);
    await flush();
    expect(hand()).toContain("rotate(90.00");

    updateBar(0.5);
    await flush();
    expect(hand()).toContain("rotate(180.00");

    actor.stop();
  });
});

describe("MachinePanel — §2.2 behaviour 2: eval flashes and updates the program row", () => {
  it("adds a row when the visualisation store registers an expression", async () => {
    const { getByTestId, queryByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: null }}
      />
    ));

    expect(queryByTestId("machine-row-a1")).toBeNull();

    updateExpressions({
      a1: {
        exprType: "a1",
        expressionText: "(a1 (fast 2 t))",
        samples: [],
        color: "#00ff41",
      },
    });
    await flush();

    const row = getByTestId("machine-row-a1");
    expect(row.textContent).toContain("(a1 (fast 2 t))");
  });

  it("flashes the program region on a real codeEvaluated event, and not before", async () => {
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: null }}
      />
    ));

    const program = () => getByTestId("machine-region-program");
    expect(program().getAttribute("data-flashing")).toBe("false");

    codeEvaluated.publish({ code: "(a1 t)" });
    await flush();

    expect(program().getAttribute("data-flashing")).toBe("true");
    expect(program().classList.contains("machine-region--flash")).toBe(true);
  });
});

describe("MachinePanel — §2.2 behaviour 3: output health, LKG shown distinctly", () => {
  it("shows running from markOutputRunning", async () => {
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: null }}
      />
    ));

    markOutputRunning("a1");
    await flush();

    const row = getByTestId("machine-row-a1");
    expect(row.getAttribute("data-state")).toBe("running");
    expect(row.getAttribute("data-lkg")).toBe("false");
    expect(row.textContent).toContain("running");
  });

  it("shows the LKG fallback state distinctly — broken but still sounding", async () => {
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: null }}
      />
    ));

    updateExpressions({
      a1: {
        exprType: "a1",
        expressionText: "(a1 0.75)",
        samples: [],
        color: null,
      },
    });
    // Exactly the active-diagnostic shape the engine emits.
    refreshOutputHealth([
      {
        start: 0,
        end: 10,
        severity: "error",
        message: "undefined name: no-such-fn",
        category: "undefinedName",
        output: "a1",
        state: "fallback",
      } as never,
    ]);
    await flush();

    const row = getByTestId("machine-row-a1");
    expect(row.getAttribute("data-state")).toBe("fallback");
    expect(row.getAttribute("data-lkg")).toBe("true");
    expect(row.textContent).toContain("holding last good");
    // The last-good expression is still shown — the output is still sounding.
    expect(row.textContent).toContain("(a1 0.75)");
    expect(outputHealth.a1.health).toBe("fallback");

    // ...and the jack reflects the same state.
    expect(getByTestId("machine-jack-a1").getAttribute("data-state")).toBe(
      "fallback",
    );
  });

  it("shows error distinctly from fallback (no LKG to fall back to)", async () => {
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: null }}
      />
    ));

    refreshOutputHealth([
      {
        start: 0,
        end: 1,
        severity: "error",
        message: "boom",
        output: "a2",
        state: "error",
      } as never,
    ]);
    await flush();

    const row = getByTestId("machine-row-a2");
    expect(row.getAttribute("data-state")).toBe("error");
    expect(row.getAttribute("data-lkg")).toBe("false");
    expect(row.textContent).toContain("stopped");
  });
});

describe("MachinePanel — §2.2 behaviour 4: jack sparks from sampled output values", () => {
  it("draws nothing until the sampler has reported values", async () => {
    const { getByTestId, queryByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{
          isLive: () => true,
          transportActor: null,
          sampleWindowFor: noSamples,
        }}
      />
    ));

    markOutputRunning("a1");
    await flush();

    expect(getByTestId("machine-jack-a1").getAttribute("data-spark-points")).toBe(
      "0",
    );
    expect(queryByTestId("machine-spark-a1")).toBeNull();
  });

  it("redraws the spark when the sampler reports new values at a new time", async () => {
    let buf = buffer([0, 0.25, 0.5]);
    const { getByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{
          isLive: () => true,
          transportActor: null,
          sampleWindowFor: (output) => (output === "a1" ? buf : null),
        }}
      />
    ));

    markOutputRunning("a1");
    await flush();

    const points = () =>
      getByTestId("machine-spark-a1").getAttribute("points") ?? "";
    const first = points();
    expect(first).not.toBe("");
    expect(getByTestId("machine-jack-a1").getAttribute("data-spark-points")).toBe(
      "3",
    );

    // A new sample window plus a real time advance from the vis runtime.
    buf = buffer([1, 0.5, 0]);
    updateTime(0.5);
    await flush();

    expect(points()).not.toBe(first);
  });
});

describe("MachinePanel — region selection reveals the idea (§2.3)", () => {
  it("reveals the explanations for the selected region and hides them again", async () => {
    const { getByTestId, queryByTestId } = render(() => (
      <WiredMachinePanel
        showPlaygrounds={false}
        sources={{ isLive: () => true, transportActor: null }}
      />
    ));

    expect(queryByTestId("machine-detail")).toBeNull();

    fireEvent.click(getByTestId("machine-region-outputs"));
    await flush();

    expect(getByTestId("machine-detail")).toBeTruthy();
    // The outputs region carries ideas 3 and 6.
    expect(getByTestId("machine-idea-values-land-on-outputs")).toBeTruthy();
    expect(
      getByTestId("machine-idea-breaking-doesnt-break-sound").textContent,
    ).toMatch(/last version that worked/i);
    expect(queryByTestId("machine-idea-time-flows-in")).toBeNull();

    fireEvent.click(getByTestId("machine-region-outputs"));
    await flush();
    expect(queryByTestId("machine-detail")).toBeNull();
  });
});
