import { describe, expect, it } from "vitest";
import { PastBuffer } from "./PastBuffer.ts";

describe("PastBuffer", () => {
  describe("construction", () => {
    it("clamps capacity to at least 1", () => {
      const buf = new PastBuffer(0);
      buf.push(1, 10);
      buf.push(2, 20); // overwrites
      expect(buf.length).toBe(1);
      expect(buf.valueAt(0)).toBe(20);
      expect(buf.timeAt(0)).toBe(2);
    });

    it("starts empty", () => {
      const buf = new PastBuffer(4);
      expect(buf.length).toBe(0);
      expect(buf.newestTime).toBe(-Infinity);
      expect(buf.oldestTime).toBe(Infinity);
    });
  });

  describe("pre-wrap (length < capacity)", () => {
    it("reads back pushed samples in order", () => {
      const buf = new PastBuffer(8);
      buf.push(0, 100);
      buf.push(1, 101);
      buf.push(2, 102);
      expect(buf.length).toBe(3);
      expect([buf.valueAt(0), buf.valueAt(1), buf.valueAt(2)]).toEqual([
        100, 101, 102,
      ]);
      expect([buf.timeAt(0), buf.timeAt(1), buf.timeAt(2)]).toEqual([0, 1, 2]);
      expect(buf.oldestTime).toBe(0);
      expect(buf.newestTime).toBe(2);
    });
  });

  describe("wraparound correctness", () => {
    it("reads a window spanning the wrap boundary in chronological order", () => {
      const cap = 4;
      const buf = new PastBuffer(cap);
      // Push 6 samples into a capacity-4 buffer. The two oldest (0,1) are
      // evicted; the live window must be [2,3,4,5] read oldest-first.
      for (let t = 0; t < 6; t++) buf.push(t, t * 10);

      expect(buf.length).toBe(cap);
      const times = [buf.timeAt(0), buf.timeAt(1), buf.timeAt(2), buf.timeAt(3)];
      const values = [
        buf.valueAt(0),
        buf.valueAt(1),
        buf.valueAt(2),
        buf.valueAt(3),
      ];
      expect(times).toEqual([2, 3, 4, 5]);
      expect(values).toEqual([20, 30, 40, 50]);
      expect(buf.oldestTime).toBe(2);
      expect(buf.newestTime).toBe(5);
    });

    it("stays chronological as the head keeps advancing past the wrap", () => {
      const buf = new PastBuffer(3);
      for (let t = 0; t < 100; t++) buf.push(t, t);
      // Window must always be the last `capacity` samples, oldest-first.
      expect([buf.timeAt(0), buf.timeAt(1), buf.timeAt(2)]).toEqual([97, 98, 99]);
      expect(buf.oldestTime).toBe(97);
      expect(buf.newestTime).toBe(99);
    });

    it("reports newest/oldest correctly right at the moment of filling", () => {
      const buf = new PastBuffer(3);
      buf.push(10, 1);
      buf.push(11, 2);
      buf.push(12, 3); // now exactly full, head wrapped to 0
      expect(buf.length).toBe(3);
      expect(buf.oldestTime).toBe(10);
      expect(buf.newestTime).toBe(12);
      buf.push(13, 4); // evicts t=10
      expect(buf.oldestTime).toBe(11);
      expect(buf.newestTime).toBe(13);
      expect([buf.timeAt(0), buf.timeAt(1), buf.timeAt(2)]).toEqual([11, 12, 13]);
    });
  });

  describe("out-of-bounds reads", () => {
    it("returns NaN for negative and past-length indices (pre-wrap)", () => {
      const buf = new PastBuffer(8);
      buf.push(0, 5);
      buf.push(1, 6);
      expect(buf.valueAt(-1)).toBeNaN();
      expect(buf.timeAt(-1)).toBeNaN();
      expect(buf.valueAt(2)).toBeNaN();
      expect(buf.timeAt(2)).toBeNaN();
      expect(buf.valueAt(100)).toBeNaN();
    });

    it("returns NaN for OOB indices after wraparound", () => {
      const buf = new PastBuffer(3);
      for (let t = 0; t < 10; t++) buf.push(t, t);
      expect(buf.valueAt(-1)).toBeNaN();
      expect(buf.valueAt(3)).toBeNaN(); // length is exactly capacity
      expect(buf.timeAt(3)).toBeNaN();
    });
  });

  describe("clear and re-extension after reset", () => {
    it("re-fills correctly after clear, with no stale samples leaking", () => {
      const buf = new PastBuffer(4);
      for (let t = 0; t < 6; t++) buf.push(t, t * 10); // wrapped state

      buf.clear();
      expect(buf.length).toBe(0);
      expect(buf.newestTime).toBe(-Infinity);
      expect(buf.oldestTime).toBe(Infinity);
      expect(buf.valueAt(0)).toBeNaN();

      // Re-extend from scratch; head was reset to 0 so indexing is the
      // simple pre-wrap path again.
      buf.push(100, 1);
      buf.push(101, 2);
      expect(buf.length).toBe(2);
      expect([buf.timeAt(0), buf.timeAt(1)]).toEqual([100, 101]);
      expect([buf.valueAt(0), buf.valueAt(1)]).toEqual([1, 2]);

      // Push past capacity again — the re-extended buffer must wrap cleanly
      // without resurrecting any pre-clear samples.
      buf.push(102, 3);
      buf.push(103, 4);
      buf.push(104, 5); // evicts t=100
      expect(buf.length).toBe(4);
      expect([buf.timeAt(0), buf.timeAt(1), buf.timeAt(2), buf.timeAt(3)]).toEqual(
        [101, 102, 103, 104],
      );
      expect([
        buf.valueAt(0),
        buf.valueAt(1),
        buf.valueAt(2),
        buf.valueAt(3),
      ]).toEqual([2, 3, 4, 5]);
    });
  });
});
