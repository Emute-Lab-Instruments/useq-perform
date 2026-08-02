/**
 * Pure-model tests for the Machine schematic.
 * Spec: docs/specs/the-machine.md §1.1, §2.1, §2.2.
 */

import { describe, it, expect } from "vitest";
import { PastBuffer } from "../../../lib/PastBuffer";
import {
  MACHINE_IDEAS,
  MACHINE_REGION_IDS,
  compareOutputNames,
  deriveRows,
  ideasForRegion,
  isHoldingLastGood,
  phaseAngleDegrees,
  rowStateLabel,
  sparkFromWindow,
  sparkPoints,
} from "./machineModel";

describe("machineModel — the six ideas", () => {
  it("has exactly six ideas, ordinals 1..6 in order", () => {
    expect(MACHINE_IDEAS).toHaveLength(6);
    expect(MACHINE_IDEAS.map((i) => i.ordinal)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("gives every idea a unique id and section id", () => {
    expect(new Set(MACHINE_IDEAS.map((i) => i.id)).size).toBe(6);
    expect(new Set(MACHINE_IDEAS.map((i) => i.sectionId)).size).toBe(6);
  });

  it("assigns every idea to one of the three regions, covering all three", () => {
    const regions = new Set(MACHINE_IDEAS.map((i) => i.region));
    expect([...regions].sort()).toEqual([...MACHINE_REGION_IDS].sort());
    for (const region of MACHINE_REGION_IDS) {
      expect(ideasForRegion(region).length).toBeGreaterThan(0);
    }
  });

  it("hides mechanism at user altitude (the-machine.md §1.1)", () => {
    // No passes, no node graphs, no slots.
    const forbidden = /\bnode graph\b|\bcompile pass\b|\bslot\b|\bCSE\b/i;
    for (const idea of MACHINE_IDEAS) {
      expect(idea.explanation).not.toMatch(forbidden);
    }
  });
});

describe("machineModel — deriveRows", () => {
  const noSamples = () => null;

  it("returns no rows when nothing is registered and nothing is unhealthy", () => {
    expect(
      deriveRows({ expressions: {}, health: {}, sampleWindowFor: noSamples }),
    ).toEqual([]);
  });

  it("does not invent a row for a merely-idle output", () => {
    const rows = deriveRows({
      expressions: {},
      health: { a1: { health: "idle" } },
      sampleWindowFor: noSamples,
    });
    expect(rows).toEqual([]);
  });

  it("makes one row per registered expression, in output order", () => {
    const rows = deriveRows({
      expressions: {
        d1: { expressionText: "(d1 1)", color: "#0f0" },
        a2: { expressionText: "(a2 bar)", color: null },
        a1: { expressionText: "(a1 t)", color: "#f00" },
      },
      health: {},
      sampleWindowFor: noSamples,
    });
    expect(rows.map((r) => r.output)).toEqual(["a1", "a2", "d1"]);
    expect(rows[0].expressionText).toBe("(a1 t)");
    expect(rows[0].colour).toBe("#f00");
  });

  it("adds health-only rows with a null expression rather than a made-up one", () => {
    const rows = deriveRows({
      expressions: {},
      health: { a4: { health: "running" } },
      sampleWindowFor: noSamples,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].output).toBe("a4");
    expect(rows[0].expressionText).toBeNull();
    expect(rows[0].state).toBe("running");
  });

  it("marks the LKG state distinctly from running and from error", () => {
    const rows = deriveRows({
      expressions: {
        a1: { expressionText: "(a1 0.75)", color: null },
        a2: { expressionText: "(a2 bar)", color: null },
        a3: { expressionText: "(a3 1)", color: null },
      },
      health: {
        a1: { health: "fallback", message: "undefined name: no-such-fn" },
        a2: { health: "running" },
        a3: { health: "error" },
      },
      sampleWindowFor: noSamples,
    });
    const [a1, a2, a3] = rows;
    expect(isHoldingLastGood(a1)).toBe(true);
    expect(isHoldingLastGood(a2)).toBe(false);
    expect(isHoldingLastGood(a3)).toBe(false);
    expect(a1.message).toContain("no-such-fn");
    expect(rowStateLabel(a1.state)).toBe("holding last good");
    expect(rowStateLabel(a2.state)).toBe("running");
  });
});

describe("machineModel — sparks", () => {
  it("is empty for a missing or empty buffer (nothing reported, nothing drawn)", () => {
    expect(sparkFromWindow(null)).toEqual([]);
    expect(sparkFromWindow(new PastBuffer(8))).toEqual([]);
  });

  it("normalises a real PastBuffer to 0..1, oldest first", () => {
    const buf = new PastBuffer(8);
    buf.push(0, 0);
    buf.push(0.1, 5);
    buf.push(0.2, 10);
    const spark = sparkFromWindow(buf);
    expect(spark).toHaveLength(3);
    expect(spark[0]).toBeCloseTo(0);
    expect(spark[2]).toBeCloseTo(1);
    expect(Math.min(...spark)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...spark)).toBeLessThanOrEqual(1);
  });

  it("draws a constant signal flat rather than exploding the range", () => {
    const buf = new PastBuffer(4);
    buf.push(0, 0.75);
    buf.push(0.1, 0.75);
    expect(sparkFromWindow(buf)).toEqual([0.5, 0.5]);
  });

  it("downsamples to at most maxPoints, always including the newest sample", () => {
    const buf = new PastBuffer(100);
    for (let i = 0; i < 100; i++) buf.push(i / 100, i);
    const spark = sparkFromWindow(buf, 10);
    expect(spark).toHaveLength(10);
    expect(spark[9]).toBeCloseTo(1);
  });

  it("builds an SVG polyline from a spark", () => {
    expect(sparkPoints([], 10, 10)).toBe("");
    expect(sparkPoints([0, 1], 10, 10)).toBe("0.00,10.00 10.00,0.00");
  });
});

describe("machineModel — misc derivations", () => {
  it("maps bar phase to a full turn", () => {
    expect(phaseAngleDegrees(0)).toBe(0);
    expect(phaseAngleDegrees(0.25)).toBe(90);
    expect(phaseAngleDegrees(1)).toBe(0);
    expect(phaseAngleDegrees(1.5)).toBe(180);
    expect(phaseAngleDegrees(NaN)).toBe(0);
  });

  it("orders outputs a, d, s, q then numerically", () => {
    const names = ["s1", "d10", "a2", "q0", "d2", "a10"];
    expect([...names].sort(compareOutputNames)).toEqual([
      "a2",
      "a10",
      "d2",
      "d10",
      "s1",
      "q0",
    ]);
  });
});
