// eslint.config.js — Import boundary rules
//
// Enforces the architectural layering described in CLAUDE.md:
//   src/lib/       → foundation (no imports from runtime, effects, ui, editors, transport)
//   src/contracts/ → shared types/constants (no imports from runtime, effects, ui, editors)
//   src/transport/ → serial/protocol layer (no imports from ui, editors)
//   src/runtime/   → bootstrap/lifecycle (no imports from ui, editors — except the
//                    per-file, per-boundary exemptions below)
//   src/effects/   → side-effect modules (no imports from ui, editors — same)
//   src/ui/        → leaf layer (can import from anywhere)
//   src/editors/   → editor layer (can import from lib, contracts, effects, transport)

import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

const srcDir = "./src";

/** Helper: create one boundary entry (files under `target` must not import from `from`). */
const boundary = (target, from, message) => ({ target, from, message });

// Single source of truth for every import boundary. Both the
// `import-x/no-restricted-paths` zones and the type-level `import()` guards
// below are derived from this table.
const boundaries = [
  // ── src/lib/ boundary ──────────────────────────────────
  // lib is the foundation layer — it must not depend on higher layers
  boundary(
    `${srcDir}/lib/`,
    `${srcDir}/runtime/`,
    "src/lib/ must not import from src/runtime/ (foundation cannot depend on runtime)"
  ),
  boundary(
    `${srcDir}/lib/`,
    `${srcDir}/effects/`,
    "src/lib/ must not import from src/effects/ (foundation cannot depend on effects)"
  ),
  boundary(
    `${srcDir}/lib/`,
    `${srcDir}/ui/`,
    "src/lib/ must not import from src/ui/ (foundation cannot depend on UI)"
  ),
  boundary(
    `${srcDir}/lib/`,
    `${srcDir}/editors/`,
    "src/lib/ must not import from src/editors/ (foundation cannot depend on editors)"
  ),
  boundary(
    `${srcDir}/lib/`,
    `${srcDir}/transport/`,
    "src/lib/ must not import from src/transport/ (foundation cannot depend on transport)"
  ),

  // ── src/contracts/ boundary ────────────────────────────
  // contracts define shared types/constants — no higher-layer deps
  boundary(
    `${srcDir}/contracts/`,
    `${srcDir}/runtime/`,
    "src/contracts/ must not import from src/runtime/ (contracts cannot depend on runtime)"
  ),
  boundary(
    `${srcDir}/contracts/`,
    `${srcDir}/effects/`,
    "src/contracts/ must not import from src/effects/ (contracts cannot depend on effects)"
  ),
  boundary(
    `${srcDir}/contracts/`,
    `${srcDir}/ui/`,
    "src/contracts/ must not import from src/ui/ (contracts cannot depend on UI)"
  ),
  boundary(
    `${srcDir}/contracts/`,
    `${srcDir}/editors/`,
    "src/contracts/ must not import from src/editors/ (contracts cannot depend on editors)"
  ),

  // ── src/transport/ boundary ────────────────────────────
  boundary(
    `${srcDir}/transport/`,
    `${srcDir}/ui/`,
    "src/transport/ must not import from src/ui/ (transport cannot depend on UI)"
  ),
  boundary(
    `${srcDir}/transport/`,
    `${srcDir}/editors/`,
    "src/transport/ must not import from src/editors/ (transport cannot depend on editors)"
  ),

  // ── src/effects/ boundary ──────────────────────────────
  boundary(
    `${srcDir}/effects/`,
    `${srcDir}/ui/`,
    "src/effects/ must not import from src/ui/ (effects are framework-agnostic)"
  ),
  boundary(
    `${srcDir}/effects/`,
    `${srcDir}/editors/`,
    "src/effects/ must not import from src/editors/ (effects are framework-agnostic)"
  ),

  // ── src/audio/ boundary (VAL-ENGINE-036) ───────────────
  // The synthesis service is the SINGLE main-thread owner of
  // AudioContext, worklet, NodeDef module compilation, and
  // engine state. No editor, effect, or transport module
  // reaches into the audio layer directly; UI adapters are
  // the only bridge, and they subscribe to the typed engine-
  // state channel rather than touching the service.
  boundary(
    `${srcDir}/audio/`,
    `${srcDir}/ui/`,
    "src/audio/ must not import from src/ui/ (audio layer stays framework-agnostic)"
  ),
  boundary(
    `${srcDir}/audio/`,
    `${srcDir}/editors/`,
    "src/audio/ must not import from src/editors/ (VAL-ENGINE-036: no editor-to-worklet control path)"
  ),
  boundary(
    `${srcDir}/audio/`,
    `${srcDir}/transport/`,
    "src/audio/ must not import from src/transport/ (audio layer is independent of serial transport)"
  ),

  // ── editors/ cannot reach into audio/ (VAL-ENGINE-036) ──
  boundary(
    `${srcDir}/editors/`,
    `${srcDir}/audio/`,
    "src/editors/ must not import from src/audio/ (VAL-ENGINE-036: engine state flows through typed channels, not editor-to-worklet shortcuts)"
  ),

  // ── src/runtime/ boundary ──────────────────────────────
  boundary(
    `${srcDir}/runtime/`,
    `${srcDir}/ui/`,
    "src/runtime/ must not import from src/ui/ (bootstrap wiring is exempted by the per-file overrides below)"
  ),
  boundary(
    `${srcDir}/runtime/`,
    `${srcDir}/editors/`,
    "src/runtime/ must not import from src/editors/ (bootstrap wiring is exempted by the per-file overrides below)"
  ),
];

const LINT_TEST_IGNORES = [
  "src/**/*.test.{ts,tsx,js,mjs}",
  "src/**/*.spec.{ts,tsx,js,mjs}",
  "src/**/*.stories.{ts,tsx}",
];

const boundariesForTargetDir = (dir) =>
  boundaries.filter((b) => b.target === `${dir}/`);

/**
 * Per-file exemptions name EXACTLY the boundaries a file may cross; every
 * other boundary stays enforced for that file. Prefer this over turning the
 * rule off, so a new forbidden import cannot slip through an old override.
 */
const withoutBoundaries = (exempt) => boundaries.filter((b) => !exempt(b));
const bootstrapUiOrEditors = (b) =>
  b.target === `${srcDir}/runtime/` &&
  (b.from === `${srcDir}/ui/` || b.from === `${srcDir}/editors/`);
const effectsEditors = (b) =>
  b.target === `${srcDir}/effects/` && b.from === `${srcDir}/editors/`;

// `import-x/no-restricted-paths` only visits import/export declarations —
// type-level `import("...")` expressions (TSImportType nodes) are invisible
// to it. Mirror every boundary with a no-restricted-syntax selector so a
// type-level import() cannot escape a zone either.
const importTypeGuardRules = (boundaryList) => ({
  "no-restricted-syntax": [
    "error",
    ...boundaryList.map((b) => ({
      selector: `TSImportType[source.value=/\\.\\.\\/${fromDirSlug(b)}\\//]`,
      message: `${b.message} — including type-level import() expressions`,
    })),
  ],
});

/** Top-level dir name of a boundary's `from` path, e.g. "runtime". */
const fromDirSlug = (b) => b.from.replace(`${srcDir}/`, "").replace(/\/$/, "");

/** One no-restricted-syntax guard block for all files under `dir`. */
const importTypeGuardBlock = (dir) => ({
  files: [`${dir}/**/*.{ts,tsx}`],
  ignores: LINT_TEST_IGNORES,
  rules: importTypeGuardRules(boundariesForTargetDir(dir)),
});

/** Guard rules for a single file's dir, with named boundaries exempted. */
const fileGuardRules = (dir, exempt) =>
  importTypeGuardRules(boundariesForTargetDir(dir).filter((b) => !exempt(b)));

const guardDirs = [
  `${srcDir}/lib`,
  `${srcDir}/contracts`,
  `${srcDir}/transport`,
  `${srcDir}/effects`,
  `${srcDir}/audio`,
  `${srcDir}/editors`,
  `${srcDir}/runtime`,
];

export default tseslint.config(
  // Global ignores
  {
    ignores: [
      "node_modules/",
      "public/",
      "deps/",
      "src-useq/",
      "scripts/",
      "plugins/",
      "test/",
      "docs/",
      "ai/",
    ],
  },

  // TypeScript parser for .ts/.tsx files
  tseslint.configs.base,

  // ── Import boundary rules ─────────────────────────────────────
  {
    files: ["src/**/*.{ts,tsx,js,jsx,mjs}"],
    ignores: LINT_TEST_IGNORES,
    plugins: {
      "import-x": importPlugin,
    },
    settings: {
      // Resolve extensionless TypeScript imports before checking layer zones.
      "import-x/resolver": {
        node: { extensions: [".js", ".jsx", ".mjs", ".ts", ".tsx", ".json"] },
      },
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        { zones: boundaries },
      ],
    },
  },

  // ── Type-level import() guards ────────────────────────────────
  // Same boundaries as the zones above, enforced for import("…") types.
  ...guardDirs.map(importTypeGuardBlock),

  // ── Per-file exemptions (narrow, per boundary) ────────────────
  //
  // Each exemption re-applies the rule with ONLY the named boundaries
  // removed; every other boundary stays enforced for the file.

  {
    // bootstrap.ts is the app entry point — it MUST wire up UI and editors.
    // appLifecycle.ts handles top-level lifecycle events (orientation lock,
    // about modal, vis panel toggle) that require UI adapter access and
    // editor chip-widget/diagnostics wiring. Both are bootstrap-adjacent and
    // share the same exception rationale.
    files: ["src/runtime/bootstrap.ts", "src/runtime/appLifecycle.ts"],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        { zones: withoutBoundaries(bootstrapUiOrEditors) },
      ],
      ...fileGuardRules(`${srcDir}/runtime`, bootstrapUiOrEditors),
    },
  },
  {
    // editorEvaluation.ts imports from editors/ for eval highlight and
    // structure tracking. This effect is tightly coupled to the editor
    // layer by design — it orchestrates editor-side effects. Its
    // effects→ui boundary stays enforced.
    files: ["src/effects/editorEvaluation.ts"],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        { zones: withoutBoundaries(effectsEditors) },
      ],
      ...fileGuardRules(`${srcDir}/effects`, effectsEditors),
    },
  },
  {
    // runtimePorts.ts references the ProducerTelemetrySnapshot type owned by
    // the Worker wire protocol. This is the single sanctioned
    // contracts→runtime crossing: type-only, one file, one module.
    files: ["src/contracts/runtimePorts.ts"],
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: boundaries.map((b) =>
            b.target === `${srcDir}/contracts/` && b.from === `${srcDir}/runtime/`
              ? { ...b, except: ["workers/wasmRuntimeWorkerProtocol.ts"] }
              : b,
          ),
        },
      ],
    },
  },
);
