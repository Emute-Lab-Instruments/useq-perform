/**
 * Regression tests for cleanCode (serial-utils).
 *
 * cleanCode prepares editor text for the serial wire. Historically it
 * DELETED newlines and comment spans, which (a) joined tokens across
 * newline-only separators — `(+ 1\\n2)` reached the device as `(+ 12)` — and
 * (b) shifted every device diagnostic offset relative to the editor document.
 * The fixed implementation replaces both with spaces so the cleaned text is
 * length-aligned with the original, and is string-literal aware so `;`
 * inside a string survives.
 */
import { describe, expect, it } from "vitest";

import { cleanCode } from "./serial-utils.ts";

describe("cleanCode", () => {
  it("keeps newline-separated tokens separated", () => {
    expect(cleanCode("(+ 1\n2)")).toBe("(+ 1 2)");
  });

  it("preserves string length so diagnostic offsets stay aligned", () => {
    const code = "(defstate x\n  (+ 1 2)) ; increment\nx";
    expect(cleanCode(code).length).toBe(code.length);
  });

  it("blanks comments out to end of line with spaces", () => {
    const code = "(+ 1 ; one\n  2)";
    const cleaned = cleanCode(code);
    expect(cleaned).toBe("(+ 1 " + " ".repeat(5) + "   2)");
    expect(cleaned.length).toBe(code.length);
    expect(cleaned).not.toContain("one");
  });

  it("does not treat ; inside a string literal as a comment", () => {
    expect(cleanCode('(print "a;b")')).toBe('(print "a;b")');
  });

  it("handles escaped quotes inside strings", () => {
    const code = '(print "a\\";b") ; real comment';
    const cleaned = cleanCode(code);
    expect(cleaned).toContain('a\\";b');
    expect(cleaned).not.toContain("real comment");
    expect(cleaned.length).toBe(code.length);
  });

  it("replaces CRLF with a single space per character (length-aligned)", () => {
    const code = "(+ 1\r\n2)";
    expect(cleanCode(code).length).toBe(code.length);
    expect(cleanCode(code)).toBe("(+ 1  2)");
  });

  it("blank a trailing comment without newline", () => {
    expect(cleanCode("(+ 1 2) ; done")).toBe("(+ 1 2) " + " ".repeat(6));
  });

  it("leaves plain single-line code untouched", () => {
    expect(cleanCode("(a1 (sin t))")).toBe("(a1 (sin t))");
  });

  it("handles an unterminated string without crashing", () => {
    const code = '(print "oops';
    expect(cleanCode(code)).toBe(code);
  });
});
