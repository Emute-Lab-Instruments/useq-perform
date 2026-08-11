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

            // ── src/audio/ boundary (VAL-ENGINE-036) ───────────────
            // The synthesis service is the SINGLE main-thread owner of
            // AudioContext, worklet, NodeDef module compilation, and
            // engine state. No editor, effect, or transport module
            // reaches into the audio layer directly; UI adapters are
            // the only bridge, and they subscribe to the typed engine-
            // state channel rather than touching the service.
            zone(
              `${srcDir}/audio/`,
              `${srcDir}/ui/`,
              "src/audio/ must not import from src/ui/ (audio layer stays framework-agnostic)"
            ),
            zone(
              `${srcDir}/audio/`,
              `${srcDir}/editors/`,
              "src/audio/ must not import from src/editors/ (VAL-ENGINE-036: no editor-to-worklet control path)"
            ),
            zone(
              `${srcDir}/audio/`,
              `${srcDir}/transport/`,
              "src/audio/ must not import from src/transport/ (audio layer is independent of serial transport)"
            ),

            // ── editors/ cannot reach into audio/ (VAL-ENGINE-036) ──
            zone(
              `${srcDir}/editors/`,
              `${srcDir}/audio/`,
              "src/editors/ must not import from src/audio/ (VAL-ENGINE-036: engine state flows through typed channels, not editor-to-worklet shortcuts)"
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
    // editorEvaluation.ts imports from editors/ for eval highlight and
    // structure tracking. This effect is tightly coupled to the editor
    // layer by design — it orchestrates editor-side effects.
    files: ["src/effects/editorEvaluation.ts"],
    rules: { "import-x/no-restricted-paths": "off" },
  },
);
