// src/lib/menu/manifest.test.ts
//
// Unit tests for the manifest loader, linter, and module-level cache.
//
// These tests build manifest fixtures inline (no `manifest.json` import) so
// the suite is independent of the v1 content authoring task (C3). They
// cover:
//
//   - structural rejection (loadManifest({})  → malformed)
//   - happy path (a valid hand-built manifest parses + caches)
//   - cross-cutting lint rules (duplicate IDs across the manifest, duplicate
//     category IDs within a tab, duplicate tab IDs, duplicate hole names
//     within a single signature)
//   - per-item kind validation (unknown kind, missing kind-specific fields,
//     literal/literalKind mismatch)
//   - hole-type validation
//   - cache get/set/clear

import { describe, it, expect, beforeEach } from "vitest";
import {
  loadManifest,
  lint,
  getCachedManifest,
  setCachedManifest,
  clearCachedManifest,
  type ManifestError,
  type Result,
} from "./manifest";
import type {
  CategoryId,
  ItemId,
  Manifest,
  SnippetTemplate,
  TabId,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture helpers — minimal hand-built manifests, no JSON import.
// ---------------------------------------------------------------------------

/** A self-contained valid manifest with one of every item kind. */
function validManifestRaw(): unknown {
  return {
    version: 1,
    tabs: [
      {
        id: "functions",
        label: "Functions",
        categories: [
          {
            id: "math",
            label: "Math",
            items: [
              {
                kind: "function",
                id: "fn-add",
                label: "+",
                head: "+",
                signature: [
                  { name: "a", type: "number" },
                  { name: "b", type: "number" },
                ],
              },
            ],
          },
        ],
      },
      {
        id: "literals",
        label: "Literals",
        categories: [
          {
            id: "numbers",
            label: "Numbers",
            items: [
              {
                kind: "literal",
                id: "lit-zero",
                label: "0",
                literal: 0,
                literalKind: "number",
              },
              {
                kind: "literal",
                id: "lit-true",
                label: "true",
                literal: true,
                literalKind: "boolean",
              },
            ],
          },
        ],
      },
      {
        id: "symbols",
        label: "Symbols",
        categories: [
          {
            id: "common",
            label: "Common",
            items: [
              { kind: "symbol", id: "sym-x", label: "x", text: "x" },
            ],
          },
        ],
      },
      {
        id: "snippets",
        label: "Snippets",
        categories: [
          {
            id: "time",
            label: "Time",
            items: [
              {
                kind: "snippet",
                id: "snip-slow",
                label: "(slow N body)",
                // SnippetTemplate is opaque at this layer — pass a stub.
                template: { __brand: "SnippetTemplate" },
              },
            ],
          },
        ],
      },
    ],
  };
}

/** Helper: assert ok and return the value. Throws (in the test sense) on Err. */
function expectOk<T>(r: Result<T, ManifestError>): T {
  if (!r.ok) {
    throw new Error(
      `expected Ok, got Err: ${r.errors.map((e) => `[${e.kind}] ${e.path}: ${e.message}`).join("\n")}`,
    );
  }
  return r.value;
}

function expectErr<T>(r: Result<T, ManifestError>): readonly ManifestError[] {
  if (r.ok) throw new Error("expected Err, got Ok");
  return r.errors;
}

// ---------------------------------------------------------------------------
// loadManifest — structural rejection
// ---------------------------------------------------------------------------

describe("loadManifest — malformed input", () => {
  beforeEach(() => clearCachedManifest());

  it("rejects an empty object", () => {
    const errors = expectErr(loadManifest({}));
    // Missing `tabs` is reported; missing `version` may also be reported.
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e) => e.kind === "invalid-field")).toBe(true);
  });

  it("rejects a non-object root", () => {
    const errors = expectErr(loadManifest(null));
    expect(errors).toHaveLength(1);
    expect(errors[0].kind).toBe("malformed");
  });

  it("rejects a wrong-version manifest", () => {
    const errors = expectErr(
      loadManifest({ version: 2, tabs: [] }),
    );
    expect(errors.some((e) => e.path === "$.version")).toBe(true);
  });

  it("rejects a manifest with non-array tabs", () => {
    const errors = expectErr(
      loadManifest({ version: 1, tabs: "nope" }),
    );
    expect(errors.some((e) => e.path === "$.tabs")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// loadManifest — happy path
// ---------------------------------------------------------------------------

describe("loadManifest — valid input", () => {
  beforeEach(() => clearCachedManifest());

  it("parses a hand-built manifest and yields all four item kinds", () => {
    const manifest = expectOk(loadManifest(validManifestRaw()));
    expect(manifest.version).toBe(1);
    expect(manifest.tabs).toHaveLength(4);

    const itemKinds = new Set(
      manifest.tabs.flatMap((t) =>
        t.categories.flatMap((c) => c.items.map((i) => i.kind)),
      ),
    );
    expect(itemKinds).toEqual(
      new Set(["function", "literal", "symbol", "snippet"]),
    );
  });

  it("produces a manifest that round-trips through setCachedManifest/getCachedManifest", () => {
    const manifest = expectOk(loadManifest(validManifestRaw()));
    setCachedManifest(manifest);
    expect(getCachedManifest()).toBe(manifest);
  });
});

// ---------------------------------------------------------------------------
// Item-kind validation
// ---------------------------------------------------------------------------

describe("loadManifest — item kind validation", () => {
  beforeEach(() => clearCachedManifest());

  it("rejects an unknown item kind", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "c",
                label: "C",
                items: [
                  { kind: "wormhole", id: "x", label: "X" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "unknown-item-kind")).toBe(true);
  });

  it("rejects a function item missing `head`", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "c",
                label: "C",
                items: [{ kind: "function", id: "x", label: "X" }],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.path.endsWith(".head"))).toBe(true);
  });

  it("rejects a literal where literalKind disagrees with literal type", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "c",
                label: "C",
                items: [
                  {
                    kind: "literal",
                    id: "lit-bad",
                    label: "bad",
                    literal: "actually a string",
                    literalKind: "number",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "invalid-field")).toBe(true);
  });

  it("rejects a snippet without a template", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "c",
                label: "C",
                items: [
                  { kind: "snippet", id: "snip", label: "label", template: "" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "invalid-template")).toBe(true);
  });

  it("rejects an unknown hole type in a function signature", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "c",
                label: "C",
                items: [
                  {
                    kind: "function",
                    id: "fn",
                    label: "fn",
                    head: "fn",
                    signature: [{ name: "h", type: "wat" }],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "unknown-hole-type")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Lint rules — cross-cutting checks
// ---------------------------------------------------------------------------

describe("lint — cross-cutting validation", () => {
  beforeEach(() => clearCachedManifest());

  it("flags duplicate item IDs across tabs", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "ta",
            label: "TA",
            categories: [
              {
                id: "ca",
                label: "CA",
                items: [
                  { kind: "symbol", id: "dup", label: "x", text: "x" },
                ],
              },
            ],
          },
          {
            id: "tb",
            label: "TB",
            categories: [
              {
                id: "cb",
                label: "CB",
                items: [
                  { kind: "symbol", id: "dup", label: "y", text: "y" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "duplicate-id")).toBe(true);
  });

  it("flags duplicate category IDs within a single tab", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "same",
                label: "A",
                items: [
                  { kind: "symbol", id: "a", label: "a", text: "a" },
                ],
              },
              {
                id: "same",
                label: "B",
                items: [
                  { kind: "symbol", id: "b", label: "b", text: "b" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "duplicate-category")).toBe(true);
  });

  it("does NOT flag the same category ID appearing in different tabs", () => {
    // Category IDs are scoped to their tab; "common" can appear in
    // multiple tabs without conflict.
    const manifest = expectOk(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "ta",
            label: "TA",
            categories: [
              {
                id: "common",
                label: "Common",
                items: [
                  { kind: "symbol", id: "ax", label: "ax", text: "ax" },
                ],
              },
            ],
          },
          {
            id: "tb",
            label: "TB",
            categories: [
              {
                id: "common",
                label: "Common",
                items: [
                  { kind: "symbol", id: "bx", label: "bx", text: "bx" },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(manifest.tabs).toHaveLength(2);
  });

  it("flags duplicate tab IDs", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          { id: "same", label: "A", categories: [] },
          { id: "same", label: "B", categories: [] },
        ],
      }),
    );
    expect(errors.some((e) => e.kind === "duplicate-tab")).toBe(true);
  });

  it("flags duplicate hole names within a single signature", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "t",
            label: "T",
            categories: [
              {
                id: "c",
                label: "C",
                items: [
                  {
                    kind: "function",
                    id: "fn",
                    label: "fn",
                    head: "fn",
                    signature: [
                      { name: "x", type: "number" },
                      { name: "x", type: "number" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    // Duplicate hole names emerge from `lint`, surfacing as `invalid-field`
    // on the second occurrence of the name.
    expect(
      errors.some(
        (e) =>
          e.kind === "invalid-field" &&
          e.message.includes('Duplicate hole name "x"'),
      ),
    ).toBe(true);
  });

  it("returns an empty error list for a clean manifest", () => {
    const manifest = expectOk(loadManifest(validManifestRaw()));
    const lintErrors = lint(manifest);
    expect(lintErrors).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// lint — direct invocation on hand-built Manifest values
// ---------------------------------------------------------------------------

describe("lint — direct invocation", () => {
  it("lints a programmatically-built Manifest without going through loadManifest", () => {
    const manifest: Manifest = {
      version: 1,
      tabs: [
        {
          id: "t" as TabId,
          label: "T",
          categories: [
            {
              id: "c" as CategoryId,
              label: "C",
              items: [
                {
                  kind: "snippet",
                  id: "sn" as ItemId,
                  label: "snippet",
                  template: { __brand: "SnippetTemplate" } as SnippetTemplate,
                },
              ],
            },
          ],
        },
      ],
    };
    expect(lint(manifest)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Cache lifecycle
// ---------------------------------------------------------------------------

describe("manifest cache", () => {
  beforeEach(() => clearCachedManifest());

  it("starts empty", () => {
    expect(getCachedManifest()).toBeNull();
  });

  it("returns the value set by setCachedManifest", () => {
    const manifest = expectOk(loadManifest(validManifestRaw()));
    setCachedManifest(manifest);
    expect(getCachedManifest()).toBe(manifest);
  });

  it("clears via clearCachedManifest", () => {
    const manifest = expectOk(loadManifest(validManifestRaw()));
    setCachedManifest(manifest);
    clearCachedManifest();
    expect(getCachedManifest()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// bd-69.13 — lint-failure cases + golden-parse
// ---------------------------------------------------------------------------

import stubManifestJson from "./manifest.json" with { type: "json" };

describe("bd-69.13: golden parse of C3 stub manifest", () => {
  it("manifest.json loads with Result.ok and zero lint errors", () => {
    const result = loadManifest(stubManifestJson);
    const manifest = expectOk(result);
    expect(manifest.version).toBe(1);
    expect(manifest.tabs.length).toBeGreaterThan(0);
    // Verify lint also passes (loadManifest runs lint internally, but confirm
    // the direct call is clean too).
    expect(lint(manifest)).toEqual([]);
  });
});

describe("bd-69.13: duplicate item ID across tabs → caught", () => {
  it("flags an item ID that appears in two different tabs", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "tab-a",
            label: "Tab A",
            categories: [
              {
                id: "cat-a",
                label: "Cat A",
                items: [
                  { kind: "symbol", id: "shared-item", label: "X", text: "x" },
                ],
              },
            ],
          },
          {
            id: "tab-b",
            label: "Tab B",
            categories: [
              {
                id: "cat-b",
                label: "Cat B",
                items: [
                  {
                    kind: "symbol",
                    id: "shared-item",
                    label: "Y",
                    text: "y",
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const dupErrors = errors.filter((e) => e.kind === "duplicate-id");
    expect(dupErrors.length).toBeGreaterThanOrEqual(1);
    expect(dupErrors[0].message).toContain("shared-item");
  });
});

describe("bd-69.13: duplicate category ID within a tab → caught", () => {
  it("flags two categories in the same tab sharing an ID", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "tab",
            label: "Tab",
            categories: [
              {
                id: "dup-cat",
                label: "First",
                items: [
                  { kind: "symbol", id: "a", label: "a", text: "a" },
                ],
              },
              {
                id: "dup-cat",
                label: "Second",
                items: [
                  { kind: "symbol", id: "b", label: "b", text: "b" },
                ],
              },
            ],
          },
        ],
      }),
    );
    const catErrors = errors.filter((e) => e.kind === "duplicate-category");
    expect(catErrors.length).toBeGreaterThanOrEqual(1);
    expect(catErrors[0].message).toContain("dup-cat");
  });
});

describe("bd-69.13: item referencing undefined hole type → caught", () => {
  it("rejects a function signature hole with an invalid type", () => {
    const errors = expectErr(
      loadManifest({
        version: 1,
        tabs: [
          {
            id: "tab",
            label: "Tab",
            categories: [
              {
                id: "cat",
                label: "Cat",
                items: [
                  {
                    kind: "function",
                    id: "fn-bad",
                    label: "bad",
                    head: "bad",
                    signature: [
                      { name: "x", type: "not-a-hole-type" },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      }),
    );
    const holeErrors = errors.filter((e) => e.kind === "unknown-hole-type");
    expect(holeErrors).toHaveLength(1);
    expect(holeErrors[0].message).toContain("not-a-hole-type");
  });
});

describe("bd-69.13: malformed JSON string → Result.Err, not throw", () => {
  it("returns Result.Err for a raw malformed string (does not throw)", () => {
    // loadManifest takes `unknown`. A non-parseable JSON string like
    // "{invalid" is just a string — isObject() rejects it, returning
    // a structured ManifestError rather than throwing.
    const result = loadManifest("{invalid");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.length).toBeGreaterThan(0);
      expect(result.errors.some((e) => e.kind === "malformed")).toBe(true);
    }
  });

  it("returns Result.Err for the number 42 (does not throw)", () => {
    const result = loadManifest(42);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].kind).toBe("malformed");
    }
  });
});
