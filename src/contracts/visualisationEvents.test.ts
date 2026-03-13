import { describe, expect, it } from "vitest";

import {
  SERIAL_VIS_AUTO_OPEN_EVENT,
  SERIAL_VIS_PALETTE_CHANGED_EVENT,
  VISUALISATION_EVENT_NAMES,
  VISUALISATION_SESSION_EVENT,
  addVisualisationEventListener,
  assertVisualisationEventContract,
  dispatchVisualisationEvent,
} from "./visualisationEvents";

describe("visualisationEvents", () => {
  it("keeps visualisation event names unique", () => {
    expect(new Set(VISUALISATION_EVENT_NAMES).size).toBe(VISUALISATION_EVENT_NAMES.length);
    expect(() => assertVisualisationEventContract()).not.toThrow();
  });

  it("dispatches typed visualisation events with the expected detail", () => {
    const events: Array<{ type: string; detail: unknown }> = [];

    addVisualisationEventListener(VISUALISATION_SESSION_EVENT, (detail) => {
      events.push({ type: VISUALISATION_SESSION_EVENT, detail });
    });
    addVisualisationEventListener(SERIAL_VIS_PALETTE_CHANGED_EVENT, (detail) => {
      events.push({ type: SERIAL_VIS_PALETTE_CHANGED_EVENT, detail });
    });
    addVisualisationEventListener(SERIAL_VIS_AUTO_OPEN_EVENT, (detail) => {
      events.push({ type: SERIAL_VIS_AUTO_OPEN_EVENT, detail });
    });

    dispatchVisualisationEvent(VISUALISATION_SESSION_EVENT, {
      kind: "data",
      bar: 0.25,
      expressions: {
        a1: {
          exprType: "a1",
          expressionText: "(a1 bar)",
          samples: [{ time: 0, value: 1 }],
          color: "#fff",
        },
      },
    });
    dispatchVisualisationEvent(SERIAL_VIS_PALETTE_CHANGED_EVENT, {
      palette: ["#111111", "#222222"],
    });
    dispatchVisualisationEvent(SERIAL_VIS_AUTO_OPEN_EVENT, undefined);

    expect(events).toEqual([
      {
        type: VISUALISATION_SESSION_EVENT,
        detail: expect.objectContaining({ kind: "data", bar: 0.25 }),
      },
      {
        type: SERIAL_VIS_PALETTE_CHANGED_EVENT,
        detail: { palette: ["#111111", "#222222"] },
      },
      {
        type: SERIAL_VIS_AUTO_OPEN_EVENT,
        detail: null,
      },
    ]);
  });
});
