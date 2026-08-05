import { describe, expect, it } from "vitest";

import { PastBuffer } from "../lib/PastBuffer";
import { applyProjectionSamples } from "./visualisationBufferApplication";

function samples(buffer: PastBuffer): Array<{ time: number; value: number }> {
  return Array.from({ length: buffer.length }, (_, index) => ({
    time: buffer.timeAt(index),
    value: buffer.valueAt(index),
  }));
}

describe("visualisation projection buffer application", () => {
  it("resets and truncates at the first non-finite sample", () => {
    const buffer = new PastBuffer(8);
    buffer.push(1, 1);
    const result = applyProjectionSamples(
      buffer,
      [
        { time: 2, value: 2 },
        { time: 3, value: Number.NaN },
        { time: 4, value: 4 },
      ],
      { reset: true },
    );
    expect(result).toEqual({ frontier: 2, appliedCount: 1 });
    expect(samples(buffer)).toEqual([{ time: 2, value: 2 }]);
  });

  it("extends with samples newer than the existing frontier", () => {
    const buffer = new PastBuffer(8);
    buffer.push(2, 2);
    const result = applyProjectionSamples(
      buffer,
      [{ time: 2, value: 20 }, { time: 3, value: 3 }],
      { reset: false },
    );
    expect(result).toEqual({ frontier: 3, appliedCount: 1 });
    expect(samples(buffer)).toEqual([
      { time: 2, value: 2 },
      { time: 3, value: 3 },
    ]);
  });
});
