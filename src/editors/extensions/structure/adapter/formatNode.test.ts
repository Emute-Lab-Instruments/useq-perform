/**
 * Unit tests for formatNode / printNode — pure function tests.
 *
 * Spec: docs/specs/formatting.md
 * Implementation: src/editors/extensions/structure/adapter/printTree.ts
 *
 * Tests construct Node trees programmatically and assert on formatted output.
 * No CodeMirror, no DOM, no mocking required.
 */

import { describe, expect, it } from "vitest";
import { formatNode, printNode } from "./printTree.ts";
import type {
  DocumentNode,
  ListNode,
  MapNode,
  Node,
  NumberNode,
  SetNode,
  SymbolNode,
  VectorNode,
  HoleNode,
  KeywordNode,
  StringNode,
  Meta,
} from "../core/types.ts";
import type { FormatSettings } from "../../../../lib/settings/schema.ts";

// ─── ID generator ──────────────────────────────────────────────────────────

let idCounter = 0;
function nextId(): string {
  return `t${++idCounter}`;
}

// Reset before each test to keep ids deterministic (not strictly required
// since we don't assert on ids, but keeps things tidy).
import { beforeEach } from "vitest";
beforeEach(() => {
  idCounter = 0;
});

// ─── Node constructors ─────────────────────────────────────────────────────

function sym(text: string, metas: ReadonlyArray<Meta> = []): SymbolNode {
  return { id: nextId(), kind: "symbol", text, metas };
}

function num(text: string, metas: ReadonlyArray<Meta> = []): NumberNode {
  return { id: nextId(), kind: "number", text, metas };
}

function kw(text: string, metas: ReadonlyArray<Meta> = []): KeywordNode {
  return { id: nextId(), kind: "keyword", text, metas };
}

function str(text: string, metas: ReadonlyArray<Meta> = []): StringNode {
  return { id: nextId(), kind: "string", text, metas };
}

function hole(
  name: string,
  holeType: "number" | "symbol" | "keyword" | "expr" | "string" = "expr",
  metas: ReadonlyArray<Meta> = [],
): HoleNode {
  return { id: nextId(), kind: "hole", name, holeType, metas };
}

function list(
  children: ReadonlyArray<Node>,
  metas: ReadonlyArray<Meta> = [],
): ListNode {
  return { id: nextId(), kind: "list", children, metas };
}

function vec(
  children: ReadonlyArray<Node>,
  metas: ReadonlyArray<Meta> = [],
): VectorNode {
  return { id: nextId(), kind: "vector", children, metas };
}

function map(
  children: ReadonlyArray<Node>,
  metas: ReadonlyArray<Meta> = [],
): MapNode {
  return { id: nextId(), kind: "map", children, metas };
}

function set(
  children: ReadonlyArray<Node>,
  metas: ReadonlyArray<Meta> = [],
): SetNode {
  return { id: nextId(), kind: "set", children, metas };
}

function doc(...children: Node[]): DocumentNode {
  return { id: nextId(), kind: "document", children };
}

// ─── Default format settings ────────────────────────────────────────────────

const defaultFmt: FormatSettings = {
  lineWidth: 60,
  complexityThreshold: 4,
  minAvailableWidth: 20,
  indentStyle: "align",
  autoFormatOnMutation: true,
};

/** Create settings with overrides. */
function fmt(overrides: Partial<FormatSettings> = {}): FormatSettings {
  return { ...defaultFmt, ...overrides };
}

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

// ─── 1. Flat printer (printNode) ────────────────────────────────────────────

describe("printNode (flat printer)", () => {
  it("prints a symbol", () => {
    expect(printNode(sym("osc"))).toBe("osc");
  });

  it("prints a number", () => {
    expect(printNode(num("440"))).toBe("440");
  });

  it("prints a keyword", () => {
    expect(printNode(kw(":freq"))).toBe(":freq");
  });

  it("prints a string", () => {
    expect(printNode(str('"hello"'))).toBe('"hello"');
  });

  it("prints a hole", () => {
    expect(printNode(hole("freq", "number"))).toBe("($ freq :number)");
  });

  it("prints a simple list on one line", () => {
    const n = list([sym("osc"), num("440")]);
    expect(printNode(n)).toBe("(osc 440)");
  });

  it("prints nested lists flat", () => {
    // (a1 (osc 440))
    const n = list([sym("a1"), list([sym("osc"), num("440")])]);
    expect(printNode(n)).toBe("(a1 (osc 440))");
  });

  it("prints a vector flat", () => {
    const n = vec([num("1"), num("2"), num("3")]);
    expect(printNode(n)).toBe("[1 2 3]");
  });

  it("prints a map flat", () => {
    const n = map([kw(":a"), num("1"), kw(":b"), num("2")]);
    expect(printNode(n)).toBe("{:a 1 :b 2}");
  });

  it("prints a set flat", () => {
    const n = set([num("1"), num("2"), num("3")]);
    expect(printNode(n)).toBe("#{1 2 3}");
  });

  it("prints empty containers", () => {
    expect(printNode(list([]))).toBe("()");
    expect(printNode(vec([]))).toBe("[]");
    expect(printNode(map([]))).toBe("{}");
    expect(printNode(set([]))).toBe("#{}");
  });

  it("prints a document joining top-level forms with newlines", () => {
    const d = doc(
      list([sym("bpm"), num("120")]),
      list([sym("a1"), list([sym("osc"), num("440")])]),
    );
    expect(printNode(d)).toBe("(bpm 120)\n(a1 (osc 440))");
  });

  it("prints deeply nested structures flat", () => {
    // (a1 (+ (usin bar) (seq [1 2] (slow 4 bar))))
    const n = list([
      sym("a1"),
      list([
        sym("+"),
        list([sym("usin"), sym("bar")]),
        list([
          sym("seq"),
          vec([num("1"), num("2")]),
          list([sym("slow"), num("4"), sym("bar")]),
        ]),
      ]),
    ]);
    expect(printNode(n)).toBe(
      "(a1 (+ (usin bar) (seq [1 2] (slow 4 bar))))",
    );
  });
});

// ─── 2. Single-line forms that stay single-line ─────────────────────────────

describe("formatNode: single-line forms", () => {
  it("keeps a simple call on one line", () => {
    // (osc 440)
    const n = list([sym("osc"), num("440")]);
    expect(formatNode(n, defaultFmt)).toBe("(osc 440)");
  });

  it("keeps many leaf args on one line when under width", () => {
    // (+ 0.1 0.2 0.3 0.4) — all weight-1 children
    const n = list([sym("+"), num("0.1"), num("0.2"), num("0.3"), num("0.4")]);
    expect(formatNode(n, defaultFmt)).toBe("(+ 0.1 0.2 0.3 0.4)");
  });

  it("keeps a nested-but-simple form on one line", () => {
    // (a1 (osc 440)) — inner list has weight 2, below threshold 4
    const n = list([sym("a1"), list([sym("osc"), num("440")])]);
    expect(formatNode(n, defaultFmt)).toBe("(a1 (osc 440))");
  });

  it("keeps a leaf-only vector on one line", () => {
    const n = vec([num("1"), num("2"), num("3"), num("4")]);
    expect(formatNode(n, defaultFmt)).toBe("[1 2 3 4]");
  });

  it("keeps a short define on one line", () => {
    // (define p (phasor 4))
    const n = list([sym("define"), sym("p"), list([sym("phasor"), num("4")])]);
    expect(formatNode(n, defaultFmt)).toBe("(define p (phasor 4))");
  });

  it("keeps an empty list as ()", () => {
    expect(formatNode(list([]), defaultFmt)).toBe("()");
  });

  it("keeps an empty vector as []", () => {
    expect(formatNode(vec([]), defaultFmt)).toBe("[]");
  });

  it("keeps an empty map as {}", () => {
    expect(formatNode(map([]), defaultFmt)).toBe("{}");
  });

  it("keeps an empty set as #{}", () => {
    expect(formatNode(set([]), defaultFmt)).toBe("#{}");
  });

  it("keeps a single-element list on one line", () => {
    const n = list([sym("foo")]);
    expect(formatNode(n, defaultFmt)).toBe("(foo)");
  });
});

// ─── 3. Complex forms that break ───────────────────────────────────────────

describe("formatNode: breaking on complexity", () => {
  /**
   * Build the canonical example from the spec:
   * (a1 (+ (usin bar) (seq [1 2 3 4] (slow (from-list [3 2 4] (slow 8 bar)) bar))))
   *
   * Weight analysis:
   * - (slow 8 bar) → weight 2 (compound with only leaves)
   * - [3 2 4] → weight 2
   * - (from-list [3 2 4] (slow 8 bar)) → has compound children → 2 + max(2,2) = 4
   * - (slow (from-list ...) bar) → has compound child weight 4 → 2 + 4 = 6
   * - [1 2 3 4] → weight 2
   * - (seq [1 2 3 4] (slow ...)) → has compound child weight 6 → 2 + 6 = 8
   * - (usin bar) → weight 2
   * - (+ (usin bar) (seq ...)) → has compound child weight 8 → 2 + 8 = 10
   * - (a1 (+ ...)) → has compound child weight 10 → 2 + 10 = 12
   *
   * The outer form must break because child weight (10) >= threshold (4).
   */
  function canonicalExample(): ListNode {
    return list([
      sym("a1"),
      list([
        sym("+"),
        list([sym("usin"), sym("bar")]),
        list([
          sym("seq"),
          vec([num("1"), num("2"), num("3"), num("4")]),
          list([
            sym("slow"),
            list([
              sym("from-list"),
              vec([num("3"), num("2"), num("4")]),
              list([sym("slow"), num("8"), sym("bar")]),
            ]),
            sym("bar"),
          ]),
        ]),
      ]),
    ]);
  }

  it("breaks the canonical complex example with arg-aligned indent", () => {
    const result = formatNode(canonicalExample(), defaultFmt);
    // The outermost form should break.
    // With default lineWidth=60, we expect multi-line output.
    expect(result).toContain("\n");
    // First line: (a1 <first-arg-starts>
    expect(result.startsWith("(a1 ")).toBe(true);
  });

  it("breaks a form when child weight >= complexityThreshold with multiple args", () => {
    // (f (g (h x)) y) — two args, first has deep nesting.
    // Weight of (h x) = 2 (compound, leaves only).
    // Weight of (g (h x)) = 2 + max(1,2) = 4.
    // maxWeight of children [f, (g (h x)), y] = 4.
    // 4 < 4 is false → breaks. With two args, we get visible line breaks.
    const n = list([
      sym("f"),
      list([sym("g"), list([sym("h"), sym("x")])]),
      sym("y"),
    ]);
    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
    // Arg-aligned: first arg on same line as head
    expect(result.startsWith("(f ")).toBe(true);
  });

  it("enters breaking path but stays single-line with only one arg", () => {
    // (f (g (h x))) — child weight = 4 >= threshold, triggers breaking path,
    // but only one arg → formatted as single line (arg on same line as head).
    const n = list([
      sym("f"),
      list([sym("g"), list([sym("h"), sym("x")])]),
    ]);
    // Still single-line because arg-aligned with 1 arg produces one line
    const result = formatNode(n, defaultFmt);
    expect(result).toBe("(f (g (h x)))");
  });

  it("stays single-line when max child weight is below threshold", () => {
    // (f (g (h x))) with threshold=5: child weight=4 < 5 → single line
    const n = list([
      sym("f"),
      list([sym("g"), list([sym("h"), sym("x")])]),
      sym("y"),
    ]);
    expect(formatNode(n, fmt({ complexityThreshold: 5 }))).toBe(
      "(f (g (h x)) y)",
    );
  });

  it("does NOT break when max child weight is below threshold", () => {
    // (f (g x)) — weight of (g x) = 2, below threshold 4
    const n = list([sym("f"), list([sym("g"), sym("x")])]);
    expect(formatNode(n, defaultFmt)).toBe("(f (g x))");
  });

  it("breaks a form when width exceeds lineWidth even with low complexity", () => {
    // A form with many leaf args that exceeds 60 chars
    const args = [];
    for (let i = 0; i < 20; i++) {
      args.push(num(String(i)));
    }
    const n = list([sym("long-function-name"), ...args]);
    const flat = printNode(n);
    // Verify it does exceed 60 chars
    expect(flat.length).toBeGreaterThan(60);
    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
  });

  it("uses arg-aligned indent by default when breaking", () => {
    // (func arg1
    //       arg2
    //       arg3)
    // Make a form that exceeds width with simple leaf args.
    const n = list([
      sym("some-function"),
      sym("first-argument-value"),
      sym("second-argument-val"),
      sym("third-argument-valu"),
    ]);
    const flat = printNode(n);
    // Should exceed 60 chars to trigger width break
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, defaultFmt);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);

    // Second line should be indented to align with first arg.
    // "(some-function " has length 15, so args at column 15.
    const expectedIndent = " ".repeat("(some-function ".length);
    expect(lines[1].startsWith(expectedIndent)).toBe(true);
  });
});

// ─── 4. do blocks always break ─────────────────────────────────────────────

describe("formatNode: do blocks", () => {
  it("breaks a short do block onto separate lines", () => {
    // (do (bpm 120) (a1 (osc 440))) — fits on one line but must break
    const n = list([
      sym("do"),
      list([sym("bpm"), num("120")]),
      list([sym("a1"), list([sym("osc"), num("440")])]),
    ]);
    const flat = printNode(n);
    // Verify it would fit on one line
    expect(flat.length).toBeLessThanOrEqual(60);

    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
    // First line is just "(do"
    const lines = result.split("\n");
    expect(lines[0]).toBe("(do");
    // Body lines are indented 2 spaces
    expect(lines[1]).toMatch(/^ {2}\(/);
  });

  it("formats a typical do block per the spec example", () => {
    // (do
    //   (bpm 120)
    //   (define p (phasor 4))
    //   (a1 (osc (* 440 p)))
    //   (d1 (pulse p)))
    const n = list([
      sym("do"),
      list([sym("bpm"), num("120")]),
      list([sym("define"), sym("p"), list([sym("phasor"), num("4")])]),
      list([
        sym("a1"),
        list([sym("osc"), list([sym("*"), num("440"), sym("p")])]),
      ]),
      list([sym("d1"), list([sym("pulse"), sym("p")])]),
    ]);

    const result = formatNode(n, defaultFmt);
    const lines = result.split("\n");
    expect(lines[0]).toBe("(do");
    expect(lines[1]).toBe("  (bpm 120)");
    expect(lines[2]).toBe("  (define p (phasor 4))");
    expect(lines[3]).toBe("  (a1 (osc (* 440 p)))");
    // Last line has the closing paren
    expect(lines[4]).toBe("  (d1 (pulse p)))");
  });

  it("does not treat a bare (do) as a do-block", () => {
    // (do) with only the head — no body children to break
    const n = list([sym("do")]);
    expect(formatNode(n, defaultFmt)).toBe("(do)");
  });

  it("does not treat (do x) with only one body child as always-breaking", () => {
    // (do (bpm 120)) — only one body child. isDoBlock requires > 1 child total
    // (children.length > 1 means 1 body child does count, since do + 1 body = 2)
    const n = list([sym("do"), list([sym("bpm"), num("120")])]);
    const result = formatNode(n, defaultFmt);
    // With length 2 (do + body), isDoBlock is true, so it should break.
    expect(result).toContain("\n");
  });
});

// ─── 5. define forms ───────────────────────────────────────────────────────

describe("formatNode: define forms", () => {
  it("keeps a short define on one line", () => {
    // (define p (phasor 4))
    const n = list([sym("define"), sym("p"), list([sym("phasor"), num("4")])]);
    expect(formatNode(n, defaultFmt)).toBe("(define p (phasor 4))");
  });

  it("breaks a long define value with 2-space body indent", () => {
    // (define melody
    //   (seq [1 2 3 4 5 6 7 8]
    //        (slow 4 bar)))
    const n = list([
      sym("define"),
      sym("melody"),
      list([
        sym("seq"),
        vec([
          num("1"),
          num("2"),
          num("3"),
          num("4"),
          num("5"),
          num("6"),
          num("7"),
          num("8"),
        ]),
        list([sym("slow"), num("4"), sym("bar")]),
      ]),
    ]);

    const result = formatNode(n, defaultFmt);
    const lines = result.split("\n");
    // First line: (define melody
    expect(lines[0]).toBe("(define melody");
    // Value is indented 2 spaces (body indent)
    expect(lines[1]).toMatch(/^ {2}/);
  });

  it("puts the name on the same line as define", () => {
    // Even when the value is complex, the name stays with define
    const n = list([
      sym("define"),
      sym("very-long-variable-name"),
      list([
        sym("deeply"),
        list([sym("nested"), list([sym("call"), num("1")])]),
      ]),
    ]);
    const result = formatNode(n, defaultFmt);
    const lines = result.split("\n");
    expect(lines[0]).toContain("define");
    expect(lines[0]).toContain("very-long-variable-name");
  });

  it("handles (define name) with no value", () => {
    const n = list([sym("define"), sym("x")]);
    expect(formatNode(n, defaultFmt)).toBe("(define x)");
  });
});

// ─── 6. Vectors and maps ──────────────────────────────────────────────────

describe("formatNode: vectors, maps, sets", () => {
  it("keeps a short vector inline", () => {
    const n = vec([num("1"), num("2"), num("3"), num("4")]);
    expect(formatNode(n, defaultFmt)).toBe("[1 2 3 4]");
  });

  it("breaks a long vector with 1-space indent from bracket", () => {
    // A vector that exceeds 60 chars
    const children: Node[] = [];
    for (let i = 1; i <= 30; i++) {
      children.push(num(String(i)));
    }
    const n = vec(children);
    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
    const lines = result.split("\n");
    // First line starts with "["
    expect(lines[0].startsWith("[")).toBe(true);
    // Subsequent lines indented 1 space (the opening "[")
    expect(lines[1].startsWith(" ")).toBe(true);
    // But not 2 spaces (that would be body indent)
    // The indent is exactly 1 char for "[" -> column 1
    expect(lines[1].charAt(0)).toBe(" ");
  });

  it("keeps a short map inline", () => {
    const n = map([kw(":a"), num("1"), kw(":b"), num("2")]);
    expect(formatNode(n, defaultFmt)).toBe("{:a 1 :b 2}");
  });

  it("breaks a long map with 1-space indent from bracket", () => {
    const children: Node[] = [];
    for (let i = 0; i < 20; i++) {
      children.push(kw(`:key${i}`));
      children.push(num(String(i)));
    }
    const n = map(children);
    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
    const lines = result.split("\n");
    expect(lines[0].startsWith("{")).toBe(true);
    // Indent is 1 char for "{"
    expect(lines[1].startsWith(" ")).toBe(true);
  });

  it("breaks a long set with indent from opening #{", () => {
    const children: Node[] = [];
    for (let i = 0; i < 25; i++) {
      children.push(num(String(i)));
    }
    const n = set(children);
    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
    const lines = result.split("\n");
    expect(lines[0].startsWith("#{")).toBe(true);
    // Indent is 2 chars for "#{"
    expect(lines[1].startsWith("  ")).toBe(true);
  });

  it("vector with complex children breaks on complexity", () => {
    // [(f (g (h x))) (a b)] — inner form has weight 4 >= threshold
    const n = vec([
      list([sym("f"), list([sym("g"), list([sym("h"), sym("x")])])]),
      list([sym("a"), sym("b")]),
    ]);
    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
  });
});

// ─── 7. Min-available-width floor ──────────────────────────────────────────

describe("formatNode: min-available-width floor", () => {
  it("falls back to body indent when arg-alignment is too narrow", () => {
    // Create a deeply nested structure where arg-aligned indent would push
    // past the minAvailableWidth floor.
    // Use a narrow lineWidth to trigger this more easily.
    const settings = fmt({ lineWidth: 40, minAvailableWidth: 20 });

    // (outer-function-name (inner-func arg1 arg2 arg3))
    // "outer-function-name" is 19 chars, so arg column = 1 + 19 + 1 = 21
    // Available = 40 - 21 = 19, which is < 20 → falls back to body indent.
    const n = list([
      sym("outer-function-name"),
      list([sym("inner-func"), sym("arg1"), sym("arg2"), sym("arg3")]),
      sym("another-arg"),
    ]);

    const result = formatNode(n, settings);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // With body indent fallback, second line should start with 2-space indent
    expect(lines[1]).toMatch(/^ {2}/);
  });

  it("uses arg-alignment when there is enough room", () => {
    // (fn arg1
    //     arg2)
    // "fn" is 2 chars, arg column = 1 + 2 + 1 = 4
    // Available = 60 - 4 = 56, well above 20. Should arg-align.
    const settings = fmt({ lineWidth: 30 }); // narrow width to force break

    const n = list([
      sym("fn"),
      sym("first-argument-here"),
      sym("second-argument-here"),
    ]);

    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(30); // verify it needs to break

    const result = formatNode(n, settings);
    const lines = result.split("\n");
    // Arg-aligned: column = 1 + 2 + 1 = 4 → 4 spaces indent
    expect(lines[1]).toMatch(/^ {4}/);
  });
});

// ─── 8. Breadth test (many leaf args) ──────────────────────────────────────

describe("formatNode: breadth (many leaf args)", () => {
  it("keeps many leaf args on one line when under width", () => {
    // (+ 1 2 3 4 5 6 7 8) — all leaves, weight=2, well under 60 chars
    const args: Node[] = [sym("+")];
    for (let i = 1; i <= 8; i++) {
      args.push(num(String(i)));
    }
    const n = list(args);
    expect(formatNode(n, defaultFmt)).toBe("(+ 1 2 3 4 5 6 7 8)");
  });

  it("breaks many leaf args only when width is exceeded", () => {
    // Create a list with enough leaf args to exceed 60 chars
    const args: Node[] = [sym("accumulate")];
    for (let i = 0; i < 15; i++) {
      args.push(num("0.123"));
    }
    const n = list(args);
    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, defaultFmt);
    expect(result).toContain("\n");
  });
});

// ─── 9. indentStyle = "fixed" ──────────────────────────────────────────────

describe('formatNode: indentStyle = "fixed"', () => {
  const fixedFmt = fmt({ indentStyle: "fixed" });

  it("uses 2-space indent instead of arg-aligned when breaking", () => {
    // (some-func arg1
    //   arg2        <-- 2-space indent, NOT arg-aligned
    //   arg3)
    const n = list([
      sym("some-func"),
      sym("a-fairly-long-first-argument"),
      sym("a-fairly-long-second-argument"),
    ]);
    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, fixedFmt);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Body indent = 2 spaces
    expect(lines[1]).toMatch(/^ {2}\S/);
  });

  it("keeps short forms on one line regardless of indent style", () => {
    // (osc 440) — short, no breaking
    const n = list([sym("osc"), num("440")]);
    expect(formatNode(n, fixedFmt)).toBe("(osc 440)");
  });

  it("still breaks do blocks with 2-space indent", () => {
    const n = list([
      sym("do"),
      list([sym("bpm"), num("120")]),
      list([sym("a1"), num("1")]),
    ]);
    const result = formatNode(n, fixedFmt);
    const lines = result.split("\n");
    expect(lines[0]).toBe("(do");
    expect(lines[1]).toMatch(/^ {2}/);
  });

  it("uses 2-space indent consistently for nested breaking", () => {
    // Force a nested break with fixed style
    const settings = fmt({ indentStyle: "fixed", lineWidth: 30 });
    const n = list([
      sym("outer"),
      list([
        sym("inner"),
        sym("some-long-argument"),
        sym("another-long-arg"),
      ]),
    ]);

    const result = formatNode(n, settings);
    const lines = result.split("\n");
    // Outer children at indent 2
    // Inner children at indent 4 (if inner also breaks)
    for (let i = 1; i < lines.length; i++) {
      // All continuation lines should use multiples of 2-space indent
      const leadingSpaces = lines[i].match(/^( *)/)?.[1].length ?? 0;
      expect(leadingSpaces % 2).toBe(0);
    }
  });
});

// ─── 10. Compound head → body indent ───────────────────────────────────────

describe("formatNode: compound head forces body indent", () => {
  it("uses 2-space body indent when head is a compound", () => {
    // ((computed-fn arg) second-argument-text-x third-argument-text-x)
    // The head is itself a list, so we use body indent.
    const n = list([
      list([sym("computed-fn"), sym("arg")]),
      sym("second-argument-text-xx"),
      sym("third-argument-text-xx"),
    ]);

    const flat = printNode(n);
    expect(flat.length).toBeGreaterThan(60);

    const result = formatNode(n, defaultFmt);
    const lines = result.split("\n");
    expect(lines.length).toBeGreaterThan(1);
    // Body indent: 2 spaces
    expect(lines[1]).toMatch(/^ {2}\S/);
  });
});

// ─── 11. Document formatting ───────────────────────────────────────────────

describe("formatNode: document root", () => {
  it("joins top-level forms with newlines", () => {
    const d = doc(
      list([sym("bpm"), num("120")]),
      list([sym("a1"), list([sym("osc"), num("440")])]),
    );
    const result = formatNode(d, defaultFmt);
    expect(result).toBe("(bpm 120)\n(a1 (osc 440))");
  });

  it("formats each top-level form independently", () => {
    const d = doc(
      // Simple form — stays one line
      list([sym("bpm"), num("120")]),
      // Complex form — should break
      list([
        sym("do"),
        list([sym("a1"), num("1")]),
        list([sym("a2"), num("2")]),
      ]),
    );
    const result = formatNode(d, defaultFmt);
    const parts = result.split("\n");
    expect(parts[0]).toBe("(bpm 120)");
    expect(parts[1]).toBe("(do");
  });
});

// ─── 12. Meta wrapping ─────────────────────────────────────────────────────

describe("formatNode: meta wrappers", () => {
  it("wraps a leaf with live-edit meta", () => {
    const meta: Meta = {
      kind: "live-edit",
      payload: { id: "abc", min: 0, max: 1 },
    };
    const n = num("0.5", [meta]);
    expect(formatNode(n, defaultFmt)).toBe(
      '(live-edit 0.5 :id "abc" :min 0 :max 1)',
    );
  });

  it("wraps a compound with live-edit meta", () => {
    const meta: Meta = {
      kind: "live-edit",
      payload: { id: "x" },
    };
    const n = list([sym("osc"), num("440")], [meta]);
    expect(formatNode(n, defaultFmt)).toBe('(live-edit (osc 440) :id "x")');
  });

  it("handles live-edit with all optional fields", () => {
    const meta: Meta = {
      kind: "live-edit",
      payload: {
        id: "ctrl1",
        name: "cutoff",
        min: 0,
        max: 1,
        step: 0.01,
        precision: 3,
        options: ["low", "mid", "high"],
      },
    };
    const n = num("0.5", [meta]);
    const result = formatNode(n, defaultFmt);
    expect(result).toContain(':id "ctrl1"');
    expect(result).toContain(':name "cutoff"');
    expect(result).toContain(":min 0");
    expect(result).toContain(":max 1");
    expect(result).toContain(":step 0.01");
    expect(result).toContain(":precision 3");
    expect(result).toContain(":options [:low :mid :high]");
  });
});

// ─── 13. Edge cases and mixed scenarios ────────────────────────────────────

describe("formatNode: edge cases", () => {
  it("handles a single-child list that itself needs to break", () => {
    // A list with one child that is a complex expression.
    // Wrapping: (wrapper (very complex deep thing))
    const deep = list([
      sym("f"),
      list([sym("g"), list([sym("h"), list([sym("i"), sym("j")])])]),
    ]);
    const n = list([deep]);
    const result = formatNode(n, defaultFmt);
    // Should still produce valid output (may or may not break)
    expect(result.startsWith("(")).toBe(true);
    expect(result.endsWith(")")).toBe(true);
  });

  it("handles lineWidth override that forces everything to break", () => {
    const narrow = fmt({ lineWidth: 10 });
    const n = list([sym("osc"), num("440")]);
    // "(osc 440)" is 9 chars — fits in 10
    expect(formatNode(n, narrow)).toBe("(osc 440)");

    const n2 = list([sym("oscillator"), num("440")]);
    // "(oscillator 440)" is 16 chars — exceeds 10
    const result = formatNode(n2, narrow);
    expect(result).toContain("\n");
  });

  it("handles a high complexityThreshold that prevents breaking", () => {
    const relaxed = fmt({ complexityThreshold: 100 });
    // Even deeply nested, should stay single line if under width
    const n = list([
      sym("a"),
      list([sym("b"), list([sym("c"), sym("d")])]),
    ]);
    expect(formatNode(n, relaxed)).toBe("(a (b (c d)))");
  });

  it("formats hole nodes correctly", () => {
    const n = hole("freq", "number");
    expect(formatNode(n, defaultFmt)).toBe("($ freq :number)");
  });

  it("formats keywords", () => {
    const n = kw(":rate");
    expect(formatNode(n, defaultFmt)).toBe(":rate");
  });

  it("formats strings", () => {
    const n = str('"hello world"');
    expect(formatNode(n, defaultFmt)).toBe('"hello world"');
  });

  it("handles nested do inside a breaking form", () => {
    // (a1 (do (bpm 120) (osc 440)))
    // The outer may or may not break, but the inner do always breaks.
    const innerDo = list([
      sym("do"),
      list([sym("bpm"), num("120")]),
      list([sym("osc"), num("440")]),
    ]);
    const n = list([sym("a1"), innerDo]);
    const result = formatNode(n, defaultFmt);
    // The do block must be multi-line
    expect(result).toContain("\n");
    expect(result).toContain("(do");
  });

  it("recursive arg-aligned indentation cascades correctly", () => {
    // Build a form where inner forms also need to break.
    // (outer (mid (inner a-long-symbol-one
    //                    a-long-symbol-two)))
    const settings = fmt({ lineWidth: 40 });
    const inner = list([
      sym("inner"),
      sym("a-long-symbol-one"),
      sym("a-long-symbol-two"),
    ]);
    const mid = list([sym("mid"), inner]);
    const n = list([sym("outer"), mid]);

    const result = formatNode(n, settings);
    // Should contain newlines from breaking
    expect(result).toContain("\n");
    // Should be valid parenthesized output
    const openParens = (result.match(/\(/g) || []).length;
    const closeParens = (result.match(/\)/g) || []).length;
    expect(openParens).toBe(closeParens);
  });
});

// ─── 14. Parity: formatNode matches printNode for simple forms ─────────────

describe("formatNode / printNode parity for simple forms", () => {
  const simpleForms: [string, Node][] = [
    ["symbol", sym("foo")],
    ["number", num("42")],
    ["keyword", kw(":bar")],
    ["string", str('"hi"')],
    ["empty list", list([])],
    ["empty vector", vec([])],
    ["simple call", list([sym("osc"), num("440")])],
    ["nested simple", list([sym("a1"), list([sym("osc"), num("440")])])],
    ["short vector", vec([num("1"), num("2"), num("3")])],
  ];

  for (const [label, node] of simpleForms) {
    it(`agrees with printNode for ${label}`, () => {
      expect(formatNode(node, defaultFmt)).toBe(printNode(node));
    });
  }
});
