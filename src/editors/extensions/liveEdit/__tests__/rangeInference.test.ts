/**
 * Tests for live-edit range inference (§3.4).
 *
 * Covers every row of the inference table in docs/specs/live-edit.md §3.4,
 * plus edge cases for precision calculation.
 */

import { describe, expect, it } from "vitest";
import { inferRange } from "../rangeInference.ts";

describe("inferRange", () => {
  // ── Boolean / keyword seeds ──────────────────────────────────────────────

  it("returns null for a boolean true", () => {
    expect(inferRange(true)).toBeNull();
  });

  it("returns null for a boolean false", () => {
    expect(inferRange(false)).toBeNull();
  });

  it("returns null for a keyword string", () => {
    expect(inferRange(":foo")).toBeNull();
  });

  it("returns null for any string seed", () => {
    expect(inferRange("hello")).toBeNull();
  });

  // ── 0 ≤ X ≤ 1 ───────────────────────────────────────────────────────────

  it("0 → [0, 1]", () => {
    const r = inferRange(0);
    expect(r).toEqual({ min: 0, max: 1, precision: 1 });
  });

  it("1 → [0, 1]", () => {
    const r = inferRange(1);
    expect(r).toEqual({ min: 0, max: 1, precision: 1 });
  });

  it("0.5 → [0, 1], precision 2", () => {
    const r = inferRange(0.5);
    expect(r).toEqual({ min: 0, max: 1, precision: 2 });
  });

  it("0.123 → [0, 1], precision 4", () => {
    const r = inferRange(0.123);
    expect(r).toEqual({ min: 0, max: 1, precision: 4 });
  });

  it("0.75 → [0, 1]", () => {
    const r = inferRange(0.75);
    expect(r).toMatchObject({ min: 0, max: 1 });
  });

  // ── -1 ≤ X < 0 ──────────────────────────────────────────────────────────

  it("-1 → [-1, 0]", () => {
    const r = inferRange(-1);
    expect(r).toMatchObject({ min: -1, max: 0 });
  });

  it("-0.5 → [-1, 0]", () => {
    const r = inferRange(-0.5);
    expect(r).toMatchObject({ min: -1, max: 0 });
  });

  it("-0.01 → [-1, 0]", () => {
    const r = inferRange(-0.01);
    expect(r).toMatchObject({ min: -1, max: 0 });
  });

  // ── Integer X, parent slow / fast ────────────────────────────────────────

  it("integer 8, parent 'slow' → [1, max(16, 16)]", () => {
    const r = inferRange(8, "slow");
    expect(r).toMatchObject({ min: 1, max: 16 });
  });

  it("integer 10, parent 'slow' → [1, max(16, 20)] = [1, 20]", () => {
    const r = inferRange(10, "slow");
    expect(r).toMatchObject({ min: 1, max: 20 });
  });

  it("integer 4, parent 'fast' → [1, max(16, 8)] = [1, 16]", () => {
    const r = inferRange(4, "fast");
    expect(r).toMatchObject({ min: 1, max: 16 });
  });

  it("integer 20, parent 'fast' → [1, max(16, 40)] = [1, 40]", () => {
    const r = inferRange(20, "fast");
    expect(r).toMatchObject({ min: 1, max: 40 });
  });

  it("integer 1, parent 'slow' → [1, 16] (floor at 16)", () => {
    const r = inferRange(1, "slow");
    expect(r).toMatchObject({ min: 1, max: 16 });
  });

  // ── Number X, parent osc / phasor ────────────────────────────────────────

  it("440, parent 'osc' → [20, max(2000, 880)] = [20, 2000]", () => {
    const r = inferRange(440, "osc");
    expect(r).toMatchObject({ min: 20, max: 2000 });
  });

  it("1200, parent 'osc' → [20, max(2000, 2400)] = [20, 2400]", () => {
    const r = inferRange(1200, "osc");
    expect(r).toMatchObject({ min: 20, max: 2400 });
  });

  it("100, parent 'phasor' → [20, max(2000, 200)] = [20, 2000]", () => {
    const r = inferRange(100, "phasor");
    expect(r).toMatchObject({ min: 20, max: 2000 });
  });

  it("5000, parent 'phasor' → [20, max(2000, 10000)] = [20, 10000]", () => {
    const r = inferRange(5000, "phasor");
    expect(r).toMatchObject({ min: 20, max: 10000 });
  });

  it("decimal 440.5, parent 'osc' → [20, max(2000, 881)] = [20, 2000]", () => {
    const r = inferRange(440.5, "osc");
    expect(r).toMatchObject({ min: 20, max: 2000 });
  });

  // ── Other numeric X > 0 (no special parent) ─────────────────────────────

  it("5 → [0, 10]", () => {
    const r = inferRange(5);
    expect(r).toMatchObject({ min: 0, max: 10 });
  });

  it("3.0 (integer > 1) → [0, 6]", () => {
    const r = inferRange(3);
    expect(r).toMatchObject({ min: 0, max: 6 });
  });

  it("2.5 → [0, 5]", () => {
    const r = inferRange(2.5);
    expect(r).toMatchObject({ min: 0, max: 5 });
  });

  it("integer 8, no parent → [0, 16] (not slow/fast match)", () => {
    const r = inferRange(8);
    expect(r).toMatchObject({ min: 0, max: 16 });
  });

  it("integer 8, parent 'osc' but > 1 and not integer-slow/fast path → [20, 2000]", () => {
    // osc/phasor check applies before the generic >0 check
    const r = inferRange(8, "osc");
    expect(r).toMatchObject({ min: 20, max: 2000 });
  });

  // ── Other numeric X < 0 (no special parent) ─────────────────────────────

  it("-5 → [-10, 0]", () => {
    const r = inferRange(-5);
    expect(r).toMatchObject({ min: -10, max: 0 });
  });

  it("-2.5 → [-5, 0]", () => {
    const r = inferRange(-2.5);
    expect(r).toMatchObject({ min: -5, max: 0 });
  });

  it("-100 → [-200, 0]", () => {
    const r = inferRange(-100);
    expect(r).toMatchObject({ min: -200, max: 0 });
  });

  // ── Precision calculation ────────────────────────────────────────────────

  it("precision: integer seed gets precision 1 (0 decimals + 1)", () => {
    const r = inferRange(0.5); // 1 decimal → precision 2
    expect(r?.precision).toBe(2);
  });

  it("precision: seed 3 → precision 1", () => {
    const r = inferRange(3);
    expect(r?.precision).toBe(1);
  });

  it("precision: seed 0.5 → precision 2", () => {
    const r = inferRange(0.5);
    expect(r?.precision).toBe(2);
  });

  it("precision: seed 0.123 → precision 4", () => {
    const r = inferRange(0.123);
    expect(r?.precision).toBe(4);
  });

  it("precision: seed 10.25 → precision 3", () => {
    const r = inferRange(10.25);
    expect(r?.precision).toBe(3);
  });

  it("precision: seed 1.0 (integer) → precision 1", () => {
    // JS String(1.0) === "1", so 0 decimal places → precision 1
    const r = inferRange(1.0);
    expect(r?.precision).toBe(1);
  });

  // ── Parent head does NOT match special symbols ───────────────────────────

  it("integer 8, parent 'seq' (unrecognised) → generic >0 rule [0, 16]", () => {
    const r = inferRange(8, "seq");
    expect(r).toMatchObject({ min: 0, max: 16 });
  });

  it("440, parent 'synth' (unrecognised) → generic >0 rule [0, 880]", () => {
    const r = inferRange(440, "synth");
    expect(r).toMatchObject({ min: 0, max: 880 });
  });
});
