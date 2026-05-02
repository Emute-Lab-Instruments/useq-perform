import { describe, expect, it } from "vitest";

import { holeFocused } from "./editorChannels";
import type { HoleFocusedDetail } from "./editorChannels";

describe("editorChannels", () => {
  describe("holeFocused channel", () => {
    it("delivers typed payloads to subscribers", () => {
      const received: HoleFocusedDetail[] = [];
      const unsub = holeFocused.subscribe((detail) => {
        received.push(detail);
      });

      const payload: HoleFocusedDetail = {
        name: "freq",
        type: "number",
        from: 5,
        to: 20,
        source: "chain",
      };

      holeFocused.publish(payload);

      expect(received).toHaveLength(1);
      expect(received[0]).toEqual(payload);

      unsub();
    });

    it("supports unsubscribe", () => {
      const received: HoleFocusedDetail[] = [];
      const unsub = holeFocused.subscribe((detail) => {
        received.push(detail);
      });

      holeFocused.publish({
        name: "body",
        type: "expr",
        from: 0,
        to: 15,
        source: "navigation",
      });

      expect(received).toHaveLength(1);

      unsub();

      holeFocused.publish({
        name: "rate",
        type: "number",
        from: 3,
        to: 18,
        source: "chain",
      });

      // No new events after unsubscribe
      expect(received).toHaveLength(1);
    });

    it("delivers to multiple subscribers", () => {
      const received1: HoleFocusedDetail[] = [];
      const received2: HoleFocusedDetail[] = [];

      const unsub1 = holeFocused.subscribe((d) => received1.push(d));
      const unsub2 = holeFocused.subscribe((d) => received2.push(d));

      holeFocused.publish({
        name: "target",
        type: "symbol",
        from: 10,
        to: 25,
        source: "chain",
      });

      expect(received1).toHaveLength(1);
      expect(received2).toHaveLength(1);
      expect(received1[0]).toEqual(received2[0]);

      unsub1();
      unsub2();
    });
  });
});
