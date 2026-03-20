// eslint.config.js — Import boundary rules
//
// Enforces the architectural layering described in CLAUDE.md:
//   src/lib/       → foundation (no imports from runtime, effects, ui, editors, transport)
//   src/contracts/ → shared types/constants (no imports from runtime, effects, ui, editors)
//   src/transport/ → serial/protocol layer (no imports from ui, editors)
//   src/runtime/   → bootstrap/lifecycle (no imports from ui, editors — except bootstrap files)
//   src/effects/   → side-effect modules (no imports from ui, editors)
//   src/ui/        → leaf layer (can import from anywhere)
//   src/editors/   → editor layer (can import from lib, contracts, effects, transport)

import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import-x";

const srcDir = "./src";

/** Helper: create a zone restriction entry */
const zone = (target, from, message) => ({ target, from, message });

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
    ignores: [
      "src/**/*.test.{ts,tsx,js,mjs}",
      "src/**/*.spec.{ts,tsx,js,mjs}",
      "src/**/*.stories.{ts,tsx}",
    ],
    plugins: {
      "import-x": importPlugin,
    },
    rules: {
      "import-x/no-restricted-paths": [
        "error",
        {
          zones: [
            // ── src/lib/ boundary ──────────────────────────────────
            // lib is the foundation layer — it must not depend on higher layers
            zone(
              `${srcDir}/lib/`,
              `${srcDir}/runtime/`,
              "src/lib/ must not import from src/runtime/ (foundation cannot depend on runtime)"
            ),
            zone(
              `${srcDir}/lib/`,
              `${srcDir}/effects/`,
              "src/lib/ must not import from src/effects/ (foundation cannot depend on effects)"
            ),
            zone(
              `${srcDir}/lib/`,
              `${srcDir}/ui/`,
              "src/lib/ must not import from src/ui/ (foundation cannot depend on UI)"
            ),
            zone(
              `${srcDir}/lib/`,
              `${srcDir}/editors/`,
              "src/lib/ must not import from src/editors/ (foundation cannot depend on editors)"
            ),
            zone(
              `${srcDir}/lib/`,
              `${srcDir}/transport/`,
              "src/lib/ must not import from src/transport/ (foundation cannot depend on transport)"
            ),

            // ── src/contracts/ boundary ────────────────────────────
            // contracts define shared types/constants — no higher-layer deps
            zone(
              `${srcDir}/contracts/`,
              `${srcDir}/runtime/`,
              "src/contracts/ must not import from src/runtime/ (contracts cannot depend on runtime)"
            ),
            zone(
              `${srcDir}/contracts/`,
              `${srcDir}/effects/`,
              "src/contracts/ must not import from src/effects/ (contracts cannot depend on effects)"
            ),
            zone(
              `${srcDir}/contracts/`,
              `${srcDir}/ui/`,
              "src/contracts/ must not import from src/ui/ (contracts cannot depend on UI)"
            ),
            zone(
              `${srcDir}/contracts/`,
              `${srcDir}/editors/`,
              "src/contracts/ must not import from src/editors/ (contracts cannot depend on editors)"
            ),

            // ── src/transport/ boundary ────────────────────────────
            zone(
              `${srcDir}/transport/`,
              `${srcDir}/ui/`,
              "src/transport/ must not import from src/ui/ (transport cannot depend on UI)"
            ),
            zone(
              `${srcDir}/transport/`,
              `${srcDir}/editors/`,
              "src/transport/ must not import from src/editors/ (transport cannot depend on editors)"
            ),

            // ── src/effects/ boundary ──────────────────────────────
            zone(
              `${srcDir}/effects/`,
              `${srcDir}/ui/`,
              "src/effects/ must not import from src/ui/ (effects are framework-agnostic)"
            ),
            zone(
              `${srcDir}/effects/`,
              `${srcDir}/editors/`,
              "src/effects/ must not import from src/editors/ (effects are framework-agnostic)"
            ),

            // ── src/runtime/ boundary ──────────────────────────────
            zone(
              `${srcDir}/runtime/`,
              `${srcDir}/ui/`,
              "src/runtime/ must not import from src/ui/ (except bootstrap files — add eslint-disable if needed)"
            ),
            zone(
              `${srcDir}/runtime/`,
              `${srcDir}/editors/`,
              "src/runtime/ must not import from src/editors/ (except bootstrap files — add eslint-disable if needed)"
            ),
          ],
        },
      ],
    },
  },

  // ── Per-file overrides for known exceptions ──────────────────────
  //
  // These are pre-existing boundary violations that are acknowledged and
  // tracked for future resolution. Each exception documents WHY the
  // violation exists and links to the code that should eventually fix it.

  {
    // bootstrap.ts is the app entry point — it MUST wire up UI and editors.
    // This is an intentional architectural exception, not a violation.
    files: ["src/runtime/bootstrap.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // appLifecycle.ts handles top-level lifecycle events (orientation lock,
    // about modal, vis panel toggle) that require UI adapter access.
    // It is bootstrap-adjacent and shares the same exception rationale.
    files: ["src/runtime/appLifecycle.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // persistence.ts imports isLocalStorageBypassedInStartupContext from
    // runtime/startupContext.ts. This is a known coupling — the bypass flag
    // should eventually move to lib/ or be passed as a parameter.
    files: ["src/lib/persistence.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // visualisationUtils.ts imports buffer data from transport/stream-parser.
    // This coupling should be resolved by passing buffers through the store
    // or as function parameters.
    files: ["src/lib/visualisationUtils.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // contracts/runtimeChannels.ts imports type definitions from
    // runtime/runtimeDiagnostics and runtimeSession.
    // These types should eventually move to contracts/ or lib/.
    files: [
      "src/contracts/runtimeChannels.ts",
    ],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // editorEvaluation.ts imports from editors/ for eval highlight and
    // structure tracking. This effect is tightly coupled to the editor
    // layer by design — it orchestrates editor-side effects.
    files: ["src/effects/editorEvaluation.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // effects/ui.ts imports from ui/adapters for panel toggle operations.
    // This is an effects module that directly drives UI side-effects.
    files: ["src/effects/ui.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // editorStore.ts lazily imports from runtime/ and editors/ to resolve
    // circular dependency issues. The dynamic imports are deferred, but
    // the static analysis still flags them.
    files: ["src/lib/editorStore.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // settings/normalization.ts imports the themes list from editors/themes.ts
    // to validate theme names during normalization. The theme list should
    // eventually move to lib/ or contracts/.
    files: ["src/lib/settings/normalization.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
  {
    // settings/persistence.ts imports from editors/themes.ts and
    // runtime/startupContext.ts for theme validation and localStorage bypass.
    // Same coupling as normalization.ts and lib/persistence.ts.
    files: ["src/lib/settings/persistence.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
);
