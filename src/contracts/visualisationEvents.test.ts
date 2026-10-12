import { describe, expect, it } from "vitest";

import {
  visualisationSessionChannel,
  serialVisPaletteChangedChannel,
} from "./visualisationChannels";

describe("visualisationChannels", () => {
  it("delivers typed payloads to subscribers and supports unsubscribe", () => {
    const events: Array<{ channel: string; detail: unknown }> = [];

    const unsubSession = visualisationSessionChannel.subscribe((detail) => {
      events.push({ channel: "session", detail });
    });
    const unsubPalette = serialVisPaletteChangedChannel.subscribe((detail) => {
      events.push({ channel: "palette", detail });
    });

    visualisationSessionChannel.publish({
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
    serialVisPaletteChangedChannel.publish({
      palette: ["#111111", "#222222"],
    });

    expect(events).toEqual([
      {
        channel: "session",
        detail: expect.objectContaining({ kind: "data", bar: 0.25 }),
      },
      {
        channel: "palette",
        detail: { palette: ["#111111", "#222222"] },
      },
    ]);

    // Verify unsubscribe works
    unsubSession();
    unsubPalette();

    visualisationSessionChannel.publish({ kind: "after-unsub" });
    expect(events).toHaveLength(2); // no new events
  });
});
