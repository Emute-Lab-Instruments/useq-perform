// src/lib/menu/templates.test.ts
//
// Tests for the snippet-template parser. Covers:
//   - primitive forms (numbers, atoms, strings, hole references)
//   - compound forms (lists, vectors, maps, nesting)
//   - typed hole declarations and their error modes
//   - top-level multi-form parsing
//   - error accumulation and round-trip integrity (no stray `undefined`)
//
// Bead: useq-perform-4zt.69.15.

import { describe, it, expect } from "vitest";
import { parseTemplate, type TemplateNode } from "./templates";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unwrap(src: string): readonly TemplateNode[] {
  const r = parseTemplate(src);
  if (!r.ok) {
    throw new Error(
      `expected ok parse for ${JSON.stringify(src)}, got errors: ${r.errors
        .map((e) => `[${e.path}] ${e.message}`)
        .join("; ")}`,
    );
  }
  return r.value;
}

function expectErr(src: string): readonly { path: string; message: string }[] {
  const r = parseTemplate(src);
  if (r.ok) {
    throw new Error(`expected error parse for ${JSON.stringify(src)}, got ${JSON.stringify(r.value)}`);
  }
  return r.errors;
}

// Walk the tree and assert no field is `undefined`. Round-trip safety:
// successful parses must never leak the lexer's internal sentinels.
function assertNoUndefined(node: TemplateNode | readonly TemplateNode[]): void {
  const visit = (n: TemplateNode): void => {
    for (const [k, v] of Object.entries(n)) {
      // `type` on hole references is intentionally `null`, not `undefined`.
      if (v === undefined) {
        throw new Error(`undefined field '${k}' on node kind '${n.kind}'`);
      }
    }
    if (n.kind === "list" || n.kind === "vector" || n.kind === "map") {
      n.children.forEach(visit);
    }
  };
  if (Array.isArray(node)) {
    (node as readonly TemplateNode[]).forEach(visit);
  } else {
    visit(node as TemplateNode);
  }
}

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

describe("parseTemplate — primitives", () => {
  it("parses a single integer", () => {
    expect(unwrap("42")).toEqual([{ kind: "number", value: 42 }]);
  });

  it("parses a single negative number", () => {
    expect(unwrap("-3")).toEqual([{ kind: "number", value: -3 }]);
  });

  it("parses a decimal number", () => {
    expect(unwrap("1.5")).toEqual([{ kind: "number", value: 1.5 }]);
  });

  it("parses scientific notation", () => {
    expect(unwrap("1e3")).toEqual([{ kind: "number", value: 1000 }]);
  });

  it("parses a bare atom", () => {
    expect(unwrap("saw")).toEqual([{ kind: "atom", value: "saw" }]);
  });

  it("parses a string literal", () => {
    expect(unwrap('"hello"')).toEqual([{ kind: "string", value: "hello" }]);
  });

  it("parses an escaped string", () => {
    expect(unwrap('"a\\"b"')).toEqual([{ kind: "string", value: 'a"b' }]);
  });

  it("parses a single hole reference", () => {
    expect(unwrap("$freq")).toEqual([
      { kind: "hole", name: "freq", type: null, holeKind: "reference" },
    ]);
  });
});

// ---------------------------------------------------------------------------
// Compounds and nesting
// ---------------------------------------------------------------------------

describe("parseTemplate — compounds", () => {
  it("parses a flat list of atoms and numbers", () => {
    expect(unwrap("(saw 440)")).toEqual([
      {
        kind: "list",
        children: [
          { kind: "atom", value: "saw" },
          { kind: "number", value: 440 },
        ],
      },
    ]);
  });

  it("parses a list with a hole reference", () => {
    expect(unwrap("(saw $freq)")).toEqual([
      {
        kind: "list",
        children: [
          { kind: "atom", value: "saw" },
          { kind: "hole", name: "freq", type: null, holeKind: "reference" },
        ],
      },
    ]);
  });

  it("parses three holes in a list", () => {
    const got = unwrap("(env $attack $release $body)");
    expect(got).toEqual([
      {
        kind: "list",
        children: [
          { kind: "atom", value: "env" },
          { kind: "hole", name: "attack", type: null, holeKind: "reference" },
          { kind: "hole", name: "release", type: null, holeKind: "reference" },
          { kind: "hole", name: "body", type: null, holeKind: "reference" },
        ],
      },
    ]);
  });

  it("parses nested forms", () => {
    expect(unwrap("(mul (saw $freq) 2)")).toEqual([
      {
        kind: "list",
        children: [
          { kind: "atom", value: "mul" },
          {
            kind: "list",
            children: [
              { kind: "atom", value: "saw" },
              { kind: "hole", name: "freq", type: null, holeKind: "reference" },
            ],
          },
          { kind: "number", value: 2 },
        ],
      },
    ]);
  });

  it("parses a vector", () => {
    expect(unwrap("[1 2 3]")).toEqual([
      {
        kind: "vector",
        children: [
          { kind: "number", value: 1 },
          { kind: "number", value: 2 },
          { kind: "number", value: 3 },
        ],
      },
    ]);
  });

  it("parses a map", () => {
    expect(unwrap("{:foo 1}")).toEqual([
      {
        kind: "map",
        children: [
          { kind: "atom", value: ":foo" },
          { kind: "number", value: 1 },
        ],
      },
    ]);
  });

  it("treats commas as whitespace (Clojure convention)", () => {
    expect(unwrap("[1, 2, 3]")).toEqual(unwrap("[1 2 3]"));
  });
});

// ---------------------------------------------------------------------------
// Hole declarations
// ---------------------------------------------------------------------------

describe("parseTemplate — hole declarations", () => {
  it("parses a typed hole declaration: number", () => {
    expect(unwrap("($ x :number)")).toEqual([
      { kind: "hole", name: "x", type: "number", holeKind: "declaration" },
    ]);
  });

  it("parses every HoleType", () => {
    for (const t of ["number", "symbol", "keyword", "expr", "string"] as const) {
      expect(unwrap(`($ h :${t})`)).toEqual([
        { kind: "hole", name: "h", type: t, holeKind: "declaration" },
      ]);
    }
  });

  it("parses a function-shaped template with mixed declarations", () => {
    // Mirrors the spec example in radial-menu.md §8.4.
    expect(unwrap("(slow ($ rate :number) ($ body :expr))")).toEqual([
      {
        kind: "list",
        children: [
          { kind: "atom", value: "slow" },
          { kind: "hole", name: "rate", type: "number", holeKind: "declaration" },
          { kind: "hole", name: "body", type: "expr", holeKind: "declaration" },
        ],
      },
    ]);
  });

  it("rejects an unknown hole type", () => {
    const errs = expectErr("($ x :widget)");
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.message).toMatch(/unknown-hole-type/);
  });

  it("rejects wrong-arity hole declarations", () => {
    expect(expectErr("($ x)").length).toBeGreaterThan(0);
    expect(expectErr("($ x :number :extra)").length).toBeGreaterThan(0);
  });

  it("rejects a hole declaration whose type position isn't a keyword", () => {
    const errs = expectErr("($ x foo)");
    expect(errs[0]!.message).toMatch(/keyword/);
  });
});

// ---------------------------------------------------------------------------
// Top-level forms and error handling
// ---------------------------------------------------------------------------

describe("parseTemplate — top level", () => {
  it("allows multiple top-level forms", () => {
    expect(unwrap("(saw 440) (sin 220)")).toEqual([
      {
        kind: "list",
        children: [
          { kind: "atom", value: "saw" },
          { kind: "number", value: 440 },
        ],
      },
      {
        kind: "list",
        children: [
          { kind: "atom", value: "sin" },
          { kind: "number", value: 220 },
        ],
      },
    ]);
  });

  it("returns an empty list for empty input", () => {
    expect(unwrap("")).toEqual([]);
    expect(unwrap("   \t\n  ")).toEqual([]);
  });

  it("rejects an unterminated string", () => {
    // The exact malformed snippet called out in the bead spec.
    const errs = expectErr('"(`');
    expect(errs.length).toBeGreaterThan(0);
    expect(errs[0]!.message).toMatch(/unterminated/);
  });

  it("rejects an unterminated list", () => {
    expect(expectErr("(saw 440").length).toBeGreaterThan(0);
  });

  it("rejects mismatched brackets", () => {
    expect(expectErr("(saw 440]").length).toBeGreaterThan(0);
  });

  it("rejects a stray closing bracket at the top level", () => {
    expect(expectErr(")").length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Round-trip integrity
// ---------------------------------------------------------------------------

describe("parseTemplate — round-trip integrity", () => {
  it("never produces undefined fields on successful parses", () => {
    const sources = [
      "42",
      "saw",
      "$freq",
      '"hi"',
      "(saw 440)",
      "(saw $freq)",
      "(env $a $r $b)",
      "($ x :number)",
      "(slow ($ rate :number) ($ body :expr))",
      "(mul (saw $freq) 2)",
      "[1 2 3]",
      "{:foo 1}",
      "(a) (b)",
    ];
    for (const s of sources) {
      assertNoUndefined(unwrap(s));
    }
  });

  it("preserves child order in compounds", () => {
    const got = unwrap("(a b c d e)");
    const list = got[0];
    if (list?.kind !== "list") throw new Error("expected list");
    expect(list.children.map((c) => (c.kind === "atom" ? c.value : "?"))).toEqual([
      "a",
      "b",
      "c",
      "d",
      "e",
    ]);
  });
});
