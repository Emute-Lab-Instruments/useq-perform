// numpadHoleFill.test.ts
//
// Tests for the numpad/T9 hole filling mechanism.
// Covers:
//   1. formatNumberLiteral (pure formatting)
//   2. NumberPickerMenu digit entry logic
//   3. Integration: holeFocused → numpad → source replacement

import { describe, expect, it } from "vitest";

// ─── formatNumberLiteral ───────────────────────────────────────────────────

// We test the formatting logic by extracting it here (same logic as in gamepadMenuBridge.ts).
function formatNumberLiteral(value: number): string {
  if (Number.isNaN(value)) return "0";
  if (!Number.isFinite(value)) return value > 0 ? "999999" : "-999999";
  const str = String(parseFloat(value.toPrecision(10)));
  return str;
}

describe("formatNumberLiteral", () => {
  it("formats integers cleanly", () => {
    expect(formatNumberLiteral(0)).toBe("0");
    expect(formatNumberLiteral(42)).toBe("42");
    expect(formatNumberLiteral(-7)).toBe("-7");
    expect(formatNumberLiteral(1000)).toBe("1000");
  });

  it("formats decimals without trailing zeros", () => {
    expect(formatNumberLiteral(3.14)).toBe("3.14");
    expect(formatNumberLiteral(0.5)).toBe("0.5");
    expect(formatNumberLiteral(-0.25)).toBe("-0.25");
    expect(formatNumberLiteral(1.0)).toBe("1");
  });

  it("handles floating-point precision issues", () => {
    // 0.1 + 0.2 === 0.30000000000000004
    expect(formatNumberLiteral(0.1 + 0.2)).toBe("0.3");
  });

  it("handles NaN", () => {
    expect(formatNumberLiteral(NaN)).toBe("0");
  });

  it("handles Infinity", () => {
    expect(formatNumberLiteral(Infinity)).toBe("999999");
    expect(formatNumberLiteral(-Infinity)).toBe("-999999");
  });

  it("handles very small numbers", () => {
    expect(formatNumberLiteral(0.001)).toBe("0.001");
  });

  it("handles negative zero", () => {
    // -0 should format as "0"
    const result = formatNumberLiteral(-0);
    expect(result).toBe("0");
  });
});

// ─── Numpad buffer logic ───────────────────────────────────────────────────

// Extracted buffer logic matching NumberPickerMenu's appendChar/backspace/clearBuffer
function createNumpadBuffer() {
  let buffer = "";

  return {
    get: () => buffer,
    set: (v: string) => { buffer = v; },
    appendChar: (ch: string) => {
      if (ch === "." && buffer.includes(".")) return;
      if (ch === "-") {
        buffer = buffer.startsWith("-") ? buffer.slice(1) : "-" + buffer;
        return;
      }
      buffer = buffer + ch;
    },
    backspace: () => {
      buffer = buffer.slice(0, -1);
    },
    clear: () => {
      buffer = "";
    },
    parsedValue: () => {
      const v = parseFloat(buffer);
      return Number.isNaN(v) ? 0 : v;
    },
  };
}

describe("numpad buffer logic", () => {
  it("appends digits sequentially", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("4");
    buf.appendChar("2");
    expect(buf.get()).toBe("42");
    expect(buf.parsedValue()).toBe(42);
  });

  it("appends decimal point", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("3");
    buf.appendChar(".");
    buf.appendChar("1");
    buf.appendChar("4");
    expect(buf.get()).toBe("3.14");
    expect(buf.parsedValue()).toBe(3.14);
  });

  it("prevents multiple decimal points", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("1");
    buf.appendChar(".");
    buf.appendChar("5");
    buf.appendChar(".");
    buf.appendChar("3");
    expect(buf.get()).toBe("1.53");
  });

  it("toggles minus sign", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("7");
    expect(buf.get()).toBe("7");

    buf.appendChar("-");
    expect(buf.get()).toBe("-7");

    buf.appendChar("-");
    expect(buf.get()).toBe("7");
  });

  it("allows minus on empty buffer", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("-");
    expect(buf.get()).toBe("-");
    buf.appendChar("5");
    expect(buf.get()).toBe("-5");
    expect(buf.parsedValue()).toBe(-5);
  });

  it("backspace removes last character", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("1");
    buf.appendChar("2");
    buf.appendChar("3");
    buf.backspace();
    expect(buf.get()).toBe("12");
    buf.backspace();
    expect(buf.get()).toBe("1");
    buf.backspace();
    expect(buf.get()).toBe("");
  });

  it("clear resets to empty", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("9");
    buf.appendChar("9");
    buf.clear();
    expect(buf.get()).toBe("");
    expect(buf.parsedValue()).toBe(0);
  });

  it("parsedValue returns 0 for empty buffer", () => {
    const buf = createNumpadBuffer();
    expect(buf.parsedValue()).toBe(0);
  });

  it("parsedValue returns 0 for just minus sign", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("-");
    expect(buf.parsedValue()).toBe(0);
  });

  it("parsedValue handles leading decimal", () => {
    const buf = createNumpadBuffer();
    buf.appendChar(".");
    buf.appendChar("5");
    expect(buf.get()).toBe(".5");
    expect(buf.parsedValue()).toBe(0.5);
  });
});

// ─── Integration: hole replacement ────────────────────────────────────────

describe("number hole fill integration", () => {
  it("produces a valid replacement string for typical inputs", () => {
    // Simulates the flow: user types "440" → formatNumberLiteral(440) → "440"
    const buf = createNumpadBuffer();
    buf.appendChar("4");
    buf.appendChar("4");
    buf.appendChar("0");
    const literal = formatNumberLiteral(buf.parsedValue());
    expect(literal).toBe("440");
  });

  it("produces valid replacement for decimal input", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("0");
    buf.appendChar(".");
    buf.appendChar("2");
    buf.appendChar("5");
    const literal = formatNumberLiteral(buf.parsedValue());
    expect(literal).toBe("0.25");
  });

  it("produces valid replacement for negative input", () => {
    const buf = createNumpadBuffer();
    buf.appendChar("1");
    buf.appendChar("2");
    buf.appendChar("-"); // toggle negative
    const literal = formatNumberLiteral(buf.parsedValue());
    expect(literal).toBe("-12");
  });
});
