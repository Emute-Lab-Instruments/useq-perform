// src/lib/menu/manifest.ts
//
// Manifest loader, linter, and module-level cache for the radial menu
// (docs/specs/radial-menu.md §7, §11.1).
//
// PURE MODULE — no DOM, no fetch, no Solid, no logger. The dispatcher decides
// how to surface failures (per §12.2: lint failure disables the menu, app
// continues). Errors accumulate; this module never throws on bad input.
//
// Type shapes are defined exhaustively in `./types.ts` — this file does not
// re-declare any of them. The types module uses a discriminated-union for
// `MenuItem` (FunctionItem | SymbolItem | LiteralItem | SnippetItem),
// discriminated by `kind`. There is no per-item `verbs` map; verbs are
// derived from `(item.kind, verb.kind, handedness)` by verbs.ts. Lint
// reflects that model.

import type {
  Manifest,
  MenuTab,
  MenuCategory,
  MenuItem,
  HoleSpec,
  HoleType,
  SnippetTemplate,
  TabId,
  CategoryId,
  ItemId,
} from "./types";

// ---------------------------------------------------------------------------
// Result type (accumulating errors)
// ---------------------------------------------------------------------------

/**
 * Standard accumulating-errors Result. Loader and linter both return
 * `ManifestError[]` on failure so the caller can render every problem at once.
 */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: readonly E[] };

// ---------------------------------------------------------------------------
// Error shape
// ---------------------------------------------------------------------------

export type ManifestErrorKind =
  | "malformed"
  | "duplicate-tab"
  | "duplicate-category"
  | "duplicate-id"
  | "unknown-item-kind"
  | "unknown-hole-type"
  | "invalid-template"
  | "invalid-field";

export interface ManifestError {
  readonly kind: ManifestErrorKind;
  /** Dotted/bracketed JSON pointer-ish path, e.g. `tabs[2].categories[0].items[3]`. */
  readonly path: string;
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ITEM_KINDS = ["function", "symbol", "literal", "snippet"] as const;
type ItemKind = (typeof ITEM_KINDS)[number];

const HOLE_TYPES: readonly HoleType[] = [
  "number",
  "symbol",
  "keyword",
  "expr",
  "string",
];

const LITERAL_KINDS = ["number", "boolean", "keyword"] as const;

// ---------------------------------------------------------------------------
// Tiny helpers (kept local — no imports from elsewhere in src/lib/)
// ---------------------------------------------------------------------------

function isObject(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isStringArray(x: unknown): x is readonly string[] {
  return Array.isArray(x) && x.every((e) => typeof e === "string");
}

function err(
  kind: ManifestErrorKind,
  path: string,
  message: string,
): ManifestError {
  return { kind, path, message };
}

// ---------------------------------------------------------------------------
// Structural parse (json: unknown → Manifest)
// ---------------------------------------------------------------------------
//
// Validates the shape of an unknown JSON value and produces a typed Manifest
// or an array of ManifestErrors. Does NOT enforce uniqueness or cross-tab
// constraints — those live in `lint(...)`. Splitting parse and lint keeps the
// loader's "shape is OK?" question separate from the linter's "is the content
// coherent?" question.

function parseHoleSpec(
  raw: unknown,
  path: string,
  errors: ManifestError[],
): HoleSpec | null {
  if (!isObject(raw)) {
    errors.push(err("malformed", path, "Expected object for HoleSpec"));
    return null;
  }
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.name`,
        "HoleSpec.name must be a non-empty string",
      ),
    );
    return null;
  }
  if (typeof raw.type !== "string") {
    errors.push(
      err(
        "invalid-field",
        `${path}.type`,
        "HoleSpec.type must be a string",
      ),
    );
    return null;
  }
  if (!HOLE_TYPES.includes(raw.type as HoleType)) {
    errors.push(
      err(
        "unknown-hole-type",
        `${path}.type`,
        `HoleSpec.type "${raw.type}" is not a valid HoleType (${HOLE_TYPES.join(", ")})`,
      ),
    );
    return null;
  }
  const spec: HoleSpec = {
    name: raw.name,
    type: raw.type as HoleType,
    ...(raw.default !== undefined ? { default: raw.default } : {}),
  };
  return spec;
}

function parseItem(
  raw: unknown,
  path: string,
  errors: ManifestError[],
): MenuItem | null {
  if (!isObject(raw)) {
    errors.push(err("malformed", path, "Expected object for MenuItem"));
    return null;
  }
  if (typeof raw.kind !== "string") {
    errors.push(
      err(
        "unknown-item-kind",
        `${path}.kind`,
        "MenuItem.kind must be a string",
      ),
    );
    return null;
  }
  if (!ITEM_KINDS.includes(raw.kind as ItemKind)) {
    errors.push(
      err(
        "unknown-item-kind",
        `${path}.kind`,
        `MenuItem.kind "${raw.kind}" is not one of ${ITEM_KINDS.join(", ")}`,
      ),
    );
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.id`,
        "MenuItem.id must be a non-empty string",
      ),
    );
    return null;
  }
  if (typeof raw.label !== "string" || raw.label.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.label`,
        "MenuItem.label must be a non-empty string",
      ),
    );
    return null;
  }

  const id = raw.id as ItemId;
  const label = raw.label;

  switch (raw.kind as ItemKind) {
    case "function": {
      if (typeof raw.head !== "string" || raw.head.length === 0) {
        errors.push(
          err(
            "invalid-field",
            `${path}.head`,
            "FunctionItem.head must be a non-empty string",
          ),
        );
        return null;
      }
      let signature: HoleSpec[] | undefined;
      if (raw.signature !== undefined) {
        if (!Array.isArray(raw.signature)) {
          errors.push(
            err(
              "invalid-field",
              `${path}.signature`,
              "FunctionItem.signature must be an array",
            ),
          );
          return null;
        }
        signature = [];
        for (let i = 0; i < raw.signature.length; i++) {
          const spec = parseHoleSpec(
            raw.signature[i],
            `${path}.signature[${i}]`,
            errors,
          );
          if (spec) signature.push(spec);
        }
      }
      let tags: readonly string[] | undefined;
      if (raw.tags !== undefined) {
        if (!isStringArray(raw.tags)) {
          errors.push(
            err(
              "invalid-field",
              `${path}.tags`,
              "FunctionItem.tags must be an array of strings",
            ),
          );
          return null;
        }
        tags = raw.tags;
      }
      return {
        kind: "function",
        id,
        label,
        head: raw.head,
        ...(signature ? { signature } : {}),
        ...(tags ? { tags } : {}),
      };
    }
    case "symbol": {
      if (typeof raw.text !== "string" || raw.text.length === 0) {
        errors.push(
          err(
            "invalid-field",
            `${path}.text`,
            "SymbolItem.text must be a non-empty string",
          ),
        );
        return null;
      }
      return { kind: "symbol", id, label, text: raw.text };
    }
    case "literal": {
      if (
        typeof raw.literalKind !== "string" ||
        !LITERAL_KINDS.includes(raw.literalKind as (typeof LITERAL_KINDS)[number])
      ) {
        errors.push(
          err(
            "invalid-field",
            `${path}.literalKind`,
            `LiteralItem.literalKind must be one of ${LITERAL_KINDS.join(", ")}`,
          ),
        );
        return null;
      }
      const lit = raw.literal;
      const litType = typeof lit;
      if (litType !== "number" && litType !== "boolean" && litType !== "string") {
        errors.push(
          err(
            "invalid-field",
            `${path}.literal`,
            "LiteralItem.literal must be a number, boolean, or string",
          ),
        );
        return null;
      }
      // Cross-check kind ↔ value type so 'keyword' carries a string, etc.
      const lk = raw.literalKind as (typeof LITERAL_KINDS)[number];
      const expected =
        lk === "number" ? "number" : lk === "boolean" ? "boolean" : "string";
      if (litType !== expected) {
        errors.push(
          err(
            "invalid-field",
            `${path}.literal`,
            `LiteralItem.literal must be a ${expected} when literalKind is "${lk}" (got ${litType})`,
          ),
        );
        return null;
      }
      return {
        kind: "literal",
        id,
        label,
        literal: lit as number | boolean | string,
        literalKind: lk,
      };
    }
    case "snippet": {
      // Templates are opaque (`SnippetTemplate`) per types.ts §4 — concrete
      // parsing happens in templates.ts (C6). At manifest-load time we accept
      // either a parsed-tree object or a non-empty source string — deeper
      // validation defers to the template parser.
      if (
        raw.template === undefined ||
        raw.template === null ||
        (typeof raw.template === "string" && raw.template.length === 0)
      ) {
        errors.push(
          err(
            "invalid-template",
            `${path}.template`,
            "SnippetItem.template must be present and non-empty",
          ),
        );
        return null;
      }
      // Pass the template through opaquely. The `SnippetTemplate` brand is
      // a compile-time marker; runtime accepts whatever shape the template
      // authoring layer (templates.ts / C6) provides. The cast is the
      // single point where we acknowledge that this loader does not own
      // template parsing — deeper validation defers downstream.
      return {
        kind: "snippet",
        id,
        label,
        template: raw.template as unknown as SnippetTemplate,
      };
    }
  }
}

function parseCategory(
  raw: unknown,
  path: string,
  errors: ManifestError[],
): MenuCategory | null {
  if (!isObject(raw)) {
    errors.push(err("malformed", path, "Expected object for MenuCategory"));
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.id`,
        "MenuCategory.id must be a non-empty string",
      ),
    );
    return null;
  }
  if (typeof raw.label !== "string" || raw.label.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.label`,
        "MenuCategory.label must be a non-empty string",
      ),
    );
    return null;
  }
  if (raw.icon !== undefined && typeof raw.icon !== "string") {
    errors.push(
      err(
        "invalid-field",
        `${path}.icon`,
        "MenuCategory.icon must be a string when present",
      ),
    );
    return null;
  }
  if (!Array.isArray(raw.items)) {
    errors.push(
      err(
        "invalid-field",
        `${path}.items`,
        "MenuCategory.items must be an array",
      ),
    );
    return null;
  }

  const items: MenuItem[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const item = parseItem(raw.items[i], `${path}.items[${i}]`, errors);
    if (item) items.push(item);
  }

  return {
    id: raw.id as CategoryId,
    label: raw.label,
    ...(typeof raw.icon === "string" ? { icon: raw.icon } : {}),
    items,
  };
}

function parseTab(
  raw: unknown,
  path: string,
  errors: ManifestError[],
): MenuTab | null {
  if (!isObject(raw)) {
    errors.push(err("malformed", path, "Expected object for MenuTab"));
    return null;
  }
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.id`,
        "MenuTab.id must be a non-empty string",
      ),
    );
    return null;
  }
  if (typeof raw.label !== "string" || raw.label.length === 0) {
    errors.push(
      err(
        "invalid-field",
        `${path}.label`,
        "MenuTab.label must be a non-empty string",
      ),
    );
    return null;
  }
  if (!Array.isArray(raw.categories)) {
    errors.push(
      err(
        "invalid-field",
        `${path}.categories`,
        "MenuTab.categories must be an array",
      ),
    );
    return null;
  }

  const categories: MenuCategory[] = [];
  for (let i = 0; i < raw.categories.length; i++) {
    const cat = parseCategory(
      raw.categories[i],
      `${path}.categories[${i}]`,
      errors,
    );
    if (cat) categories.push(cat);
  }

  // RightTabs validation deferred — the spec models them as functions, and
  // they are not part of v1's data-only manifest path. If a future manifest
  // ships rightTabs as data, parse them here.
  return {
    id: raw.id as TabId,
    label: raw.label,
    categories,
  };
}

/**
 * Parse an unknown JSON value into a typed `Manifest`. Validates structure
 * and per-field shapes; uniqueness / cross-cutting checks happen in `lint`.
 *
 * Successful return runs `lint` on the parsed manifest; if lint reports
 * errors the loader fails with the accumulated errors, so callers do not
 * have to remember to gate on lint separately. (Per §12.2 the menu must
 * disable itself on either failure mode.)
 */
export function loadManifest(
  json: unknown,
): Result<Manifest, ManifestError> {
  const errors: ManifestError[] = [];

  if (!isObject(json)) {
    return {
      ok: false,
      errors: [
        err("malformed", "$", "Manifest root must be an object"),
      ],
    };
  }
  if (json.version !== 1) {
    errors.push(
      err(
        "invalid-field",
        "$.version",
        `Manifest.version must be 1 (got ${JSON.stringify(json.version)})`,
      ),
    );
  }
  if (!Array.isArray(json.tabs)) {
    errors.push(
      err(
        "invalid-field",
        "$.tabs",
        "Manifest.tabs must be an array",
      ),
    );
    return { ok: false, errors };
  }

  const tabs: MenuTab[] = [];
  for (let i = 0; i < json.tabs.length; i++) {
    const tab = parseTab(json.tabs[i], `tabs[${i}]`, errors);
    if (tab) tabs.push(tab);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  const manifest: Manifest = { version: 1, tabs };
  const lintErrors = lint(manifest);
  if (lintErrors.length > 0) {
    return { ok: false, errors: lintErrors };
  }
  return { ok: true, value: manifest };
}

// ---------------------------------------------------------------------------
// Lint (cross-cutting checks on a parsed manifest)
// ---------------------------------------------------------------------------

/**
 * Cross-cutting validation on a parsed manifest. Catches the constraints
 * that span multiple items / categories / tabs:
 *
 * - Duplicate tab IDs across `manifest.tabs`.
 * - Duplicate category IDs within a single tab.
 * - Duplicate item IDs across the entire manifest.
 * - Duplicate hole names within a single function signature.
 *
 * Returns an empty array on success; an accumulating list of errors otherwise.
 * Pure: never throws, never mutates the input.
 */
export function lint(manifest: Manifest): readonly ManifestError[] {
  const errors: ManifestError[] = [];

  // Tab IDs unique across manifest.tabs.
  const seenTabs = new Set<string>();
  for (let ti = 0; ti < manifest.tabs.length; ti++) {
    const tab = manifest.tabs[ti];
    if (seenTabs.has(tab.id)) {
      errors.push(
        err(
          "duplicate-tab",
          `tabs[${ti}].id`,
          `Duplicate TabId "${tab.id}" — tab IDs must be unique across the manifest`,
        ),
      );
    } else {
      seenTabs.add(tab.id);
    }
  }

  // Category IDs unique *within* each tab; item IDs unique *across* manifest.
  const seenItemIds = new Set<string>();
  for (let ti = 0; ti < manifest.tabs.length; ti++) {
    const tab = manifest.tabs[ti];
    const seenCategories = new Set<string>();
    for (let ci = 0; ci < tab.categories.length; ci++) {
      const cat = tab.categories[ci];
      if (seenCategories.has(cat.id)) {
        errors.push(
          err(
            "duplicate-category",
            `tabs[${ti}].categories[${ci}].id`,
            `Duplicate CategoryId "${cat.id}" within tab "${tab.id}"`,
          ),
        );
      } else {
        seenCategories.add(cat.id);
      }

      for (let ii = 0; ii < cat.items.length; ii++) {
        const item = cat.items[ii];
        if (seenItemIds.has(item.id)) {
          errors.push(
            err(
              "duplicate-id",
              `tabs[${ti}].categories[${ci}].items[${ii}].id`,
              `Duplicate ItemId "${item.id}" — item IDs must be unique across the entire manifest`,
            ),
          );
        } else {
          seenItemIds.add(item.id);
        }

        // Per-kind cross-cutting checks
        if (item.kind === "function" && item.signature) {
          const seenNames = new Set<string>();
          for (let hi = 0; hi < item.signature.length; hi++) {
            const hole = item.signature[hi];
            if (seenNames.has(hole.name)) {
              errors.push(
                err(
                  "invalid-field",
                  `tabs[${ti}].categories[${ci}].items[${ii}].signature[${hi}].name`,
                  `Duplicate hole name "${hole.name}" in signature of "${item.id}" — hole names must be unique within a signature`,
                ),
              );
            } else {
              seenNames.add(hole.name);
            }
          }
        }
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Module-level cache
// ---------------------------------------------------------------------------
//
// The bootstrap path loads the manifest once and caches it; consumers
// (dispatcher, store, renderer) read via `getCachedManifest()`. Tests that
// need to override the cache use `setCachedManifest()` for setup and
// `clearCachedManifest()` for teardown.

let cached: Manifest | null = null;

export function getCachedManifest(): Manifest | null {
  return cached;
}

export function setCachedManifest(manifest: Manifest): void {
  cached = manifest;
}

export function clearCachedManifest(): void {
  cached = null;
}
