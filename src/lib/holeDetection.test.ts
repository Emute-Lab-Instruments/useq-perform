import { describe, expect, it } from "vitest";
import { findHolePositions, findHoleEnd, containsHoles } from "./holeDetection.ts";

describe("holeDetection", () => {
  describe("findHolePositions", () => {
    it("returns empty for code without holes", () => {
      expect(findHolePositions("(a1 (sin (* 440 t)))")).toEqual([]);
      expect(findHolePositions("")).toEqual([]);
      expect(findHolePositions("plain text")).toEqual([]);
    });

    it("detects a single hole", () => {
      expect(findHolePositions("($ freq :number)")).toEqual([0]);
    });

    it("detects a hole nested inside a form", () => {
      expect(findHolePositions("(a1 ($ freq :number))")).toEqual([4]);
    });

    it("detects multiple holes", () => {
      const code = "(+ ($ a :number) ($ b :number))";
      const positions = findHolePositions(code);
      expect(positions).toHaveLength(2);
      expect(positions[0]).toBe(3);
      expect(positions[1]).toBe(17);
    });

    it("requires whitespace after ($", () => {
      expect(findHolePositions("($foo)")).toEqual([]);
      expect(findHolePositions("($)")).toEqual([]);
    });

    it("matches tabs and newlines as whitespace", () => {
      expect(findHolePositions("($\tname :type)")).toHaveLength(1);
      expect(findHolePositions("($\nname :type)")).toHaveLength(1);
    });

    it("does not match $ in other contexts", () => {
      expect(findHolePositions("price$100")).toEqual([]);
      expect(findHolePositions("(price$ 10)")).toEqual([]);
    });
  });

  describe("findHoleEnd", () => {
    it("finds the closing paren of a simple hole", () => {
      const code = "($ freq :number)";
      expect(findHoleEnd(code, 0)).toBe(16);
    });

    it("finds the end of a hole nested in a form", () => {
      const code = "(a1 ($ freq :number))";
      expect(findHoleEnd(code, 4)).toBe(20);
    });

    it("handles nested parens inside a hole correctly", () => {
      // Unusual but possible: ($ complex :(list number))
      const code = "($ complex :(list number))";
      expect(findHoleEnd(code, 0)).toBe(26);
    });

    it("returns code length for unmatched parens", () => {
      const code = "($ broken";
      expect(findHoleEnd(code, 0)).toBe(code.length);
    });
  });

  describe("containsHoles", () => {
    it("returns false for code without holes", () => {
      expect(containsHoles("(a1 (sin t))")).toBe(false);
    });

    it("returns true for code with a hole", () => {
      expect(containsHoles("(a1 ($ freq :number))")).toBe(true);
    });

    it("returns true for code with multiple holes", () => {
      expect(containsHoles("(+ ($ a :number) ($ b :number))")).toBe(true);
    });
  });
});
