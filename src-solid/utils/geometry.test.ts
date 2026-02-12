import { describe, it, expect } from "vitest";
import { polarToCartesian, describeArc, getAngle } from "./geometry";

describe("polarToCartesian", () => {
  it("returns top-center at 0 degrees", () => {
    const pt = polarToCartesian(100, 100, 50, 0);
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(50);
  });

  it("returns right-center at 90 degrees", () => {
    const pt = polarToCartesian(100, 100, 50, 90);
    expect(pt.x).toBeCloseTo(150);
    expect(pt.y).toBeCloseTo(100);
  });

  it("returns bottom-center at 180 degrees", () => {
    const pt = polarToCartesian(100, 100, 50, 180);
    expect(pt.x).toBeCloseTo(100);
    expect(pt.y).toBeCloseTo(150);
  });

  it("returns left-center at 270 degrees", () => {
    const pt = polarToCartesian(100, 100, 50, 270);
    expect(pt.x).toBeCloseTo(50);
    expect(pt.y).toBeCloseTo(100);
  });
});

describe("describeArc", () => {
  it("returns an SVG path string", () => {
    const d = describeArc(100, 100, 50, 0, 90);
    expect(d).toContain("M");
    expect(d).toContain("A");
    expect(d).toContain("Z");
  });

  it("uses large arc flag for arcs > 180 degrees", () => {
    const d = describeArc(100, 100, 50, 0, 270);
    // The large arc flag should be "1" for spans > 180
    expect(d).toContain(" 1 ");
  });
});

describe("getAngle", () => {
  it("returns 0 for a point directly above center", () => {
    // Directly above: x=center, y < center
    const angle = getAngle(100, 50, 100, 100);
    expect(angle).toBeCloseTo(0);
  });

  it("returns 90 for a point directly right of center", () => {
    const angle = getAngle(150, 100, 100, 100);
    expect(angle).toBeCloseTo(90);
  });

  it("returns 180 for a point directly below center", () => {
    const angle = getAngle(100, 150, 100, 100);
    expect(angle).toBeCloseTo(180);
  });

  it("returns 270 for a point directly left of center", () => {
    const angle = getAngle(50, 100, 100, 100);
    expect(angle).toBeCloseTo(270);
  });

  it("returns values in 0-360 range", () => {
    // Check various quadrants
    for (let deg = 0; deg < 360; deg += 45) {
      const rad = ((deg - 90) * Math.PI) / 180;
      const x = 100 + 50 * Math.cos(rad);
      const y = 100 + 50 * Math.sin(rad);
      const angle = getAngle(x, y, 100, 100);
      expect(angle).toBeGreaterThanOrEqual(0);
      expect(angle).toBeLessThan(360);
    }
  });
});
