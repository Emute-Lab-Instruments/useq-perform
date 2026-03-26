# CLAUDE.md

This file provides guidance to coding agents working in this repository.

**Note**: Use `bd` for task tracking. Do not use markdown TODO tracking. See `AGENTS.md`.

## Project Overview

uSEQ Perform is the web live-coding interface for the uSEQ hardware module. This repo also contains the firmware submodule at `src-useq/`.

**Terminology**: `docs/GLOSSARY.md` is the single source of truth for naming. Consult it before introducing new terms or renaming existing concepts.

## Build and Development

- `npm run dev` - runs config server, static server, and watch builds. (`portless useq-perform npm run dev`)
- `npm run build` - `build:assets` then Vite build.
- `npm run watch` - asset + Vite watch builds.
- `npm run storybook` - Storybook dev server.
- `npm run lint` - ESLint with import boundary enforcement.

Build outputs:

- App bundles: `public/solid-dist/` (single `bundle.js` + `bundle.css`)
- Generated assets: `public/assets/` and `public/wasm/`

## Testing

Three test suites are maintained:

- `npm run test:mocha` - Mocha/Chai tests in `test/**/*.mjs`
- `npm run test:unit` - Vitest unit project
- `npm run test:contracts` - Vitest contract tests (runtime, UI, transport)
- `npm run test:all` / `npm test` - all suites
- `npm run typecheck` - TypeScript type checking

Storybook stories are also exercised through the Vitest Storybook project in Vite config.

## CI

GitHub Actions (`.github/workflows/runtime-contracts.yml`) runs on PRs and pushes to main: typecheck → contract tests → unit tests → Storybook smoke tests → app build → Storybook build → firmware test → assert pinned src-useq status.

## Architecture

### Source of Truth

- Canonical source tree: `src/`
- Entry point: `src/main.ts`
- **Reactive data flow**: `docs/REACTIVE_FLOW.md` — stores, channels, signals, and data flow paths. Consult before tracing state or adding reactive plumbing.

### Source Layout

- `src/lib/` - shared foundations: settings (schema, normalization, persistence), editor defaults, `CircularBuffer`, debug utilities, editor compartments, editor store, persistence service, gamepad manager, picker menu model
- `src/lib/settings/` - settings split: `schema.ts` (types/defaults), `normalization.ts` (validation/migration), `persistence.ts` (localStorage via persistence service)
- `src/editors/` - CodeMirror extensions, keymaps, themes (data-driven), gamepad navigation, editor keyboard utilities, editor evaluation
- `src/editors/extensions/` - CodeMirror extensions: `structure/` (ast, decorations, eval-integration), `evalHighlight`, `visReadability`, `diagnostics` (inline error squiggles from WASM)
- `src/transport/` - serial port lifecycle, JSON protocol driver, stream parser, serial utilities, connector, firmware upgrade check
- `src/runtime/` - bootstrap, runtime service, settings repository, startup context, URL params, config schema, config manager, WASM interpreter, app lifecycle, runtime diagnostics, runtime session
- `src/effects/` - side-effect modules: mock time generator, transport clock policy, transport orchestrator, editor evaluation, visualisation sampler, mock control inputs, websocket server
- `src/machines/` - XState state machines (transport)
- `src/contracts/` - typed channels (runtime, visualisation, gamepad, help), event types, capability contracts
- `src/ui/` - Solid UI components (settings, help, toolbar, modals)
- `src/ui/adapters/` - imperative adapters via `createSolidAdapter()` utility
- `src/ui/styles/` - application CSS stylesheets
- `src/ui/visualisation/` - canvas visualisation renderer (`serialVis.ts`)
- `src/utils/` - reactive stores (settings, console, visualisation, reference, snippets, output health)

### Key Design Patterns

**Typed Channels** (`src/contracts/*Channels.ts`): All inter-module communication uses typed pub/sub channels from `src/lib/typedChannel.ts`. No CustomEvents for runtime or visualisation events.

**Persistence Service** (`src/lib/persistence.ts`): All localStorage access goes through a central service with typed keys, nosave support, and JSON error recovery.

**Settings Mutation Surface**: All settings mutations go through `runtimeService` (sole mutation surface). External code reads via stores, writes via runtimeService.

**Gamepad Intent Architecture**: Gamepad emits typed intents via channels; separate subscribers handle editor navigation and menu bridging. Zero coupling to UI internals.

**Visualisation Pipeline**: Stream parser → visualisationStore (direct). No controller class. Reactive data flow.

**Import Boundaries**: Enforced via ESLint (`eslint.config.js`). `src/lib/` and `src/contracts/` must not import from higher layers.

**Diagnostic System**: The WASM interpreter produces structured diagnostics (errors, warnings, hints) with source spans, human-readable messages, and suggestions. These flow from C++ through the WASM ABI to the editor as CodeMirror inline annotations.

- `src/editors/extensions/diagnostics.ts` — CodeMirror state field that accumulates diagnostics across evals. Diagnostics persist per-range until that range is re-evaluated successfully. `pushDiagnostics()` adds diagnostics with document offset mapping; `clearDiagnosticsForRange()` removes diagnostics for a specific range.
- `src/utils/outputHealthStore.ts` — SolidJS reactive store tracking per-output health (`idle`/`running`/`fallback`/`error`). Polled per animation frame via `useq_active_diagnostics()`. Success feedback with auto-fade.
- `src/runtime/wasmInterpreter.ts` — `readLastDiagnostics()` and `readActiveDiagnostics()` parse JSON from WASM exports.
- `src/effects/editorEvaluation.ts` — after each eval, reads diagnostics, pushes them to the editor with correct document offsets, shows error messages inline instead of `"{error}"`.
- `src/contracts/wasmAbi.ts` — `useq_last_diagnostics` and `useq_active_diagnostics` as optional WASM exports.

Full spec: `src-useq/docs/ERROR_HANDLING_SPEC.md`.

## UI Adapters

UI components are mounted via `createSolidAdapter()` in `src/ui/adapters/`:

- `mountModal()`, `showModal()`, `closeModal()` - Modal dialog management
- `mountPickerMenu()`, `showPickerMenu()`, etc. - Picker menu APIs
- `mountDoubleRadialMenu()` - Gamepad radial menu
- `mountSettingsPanel()`, `mountHelpPanel()`, etc. - Panel mounting

## Dev-Mode Component Labels

A custom Babel plugin (`plugins/babel-solid-label.cjs`) automatically injects `data-component` and `data-source` attributes on the root DOM element of every PascalCase component during `npm run dev`. These attributes are stripped from production builds.

When inspecting any element in browser devtools you'll see e.g.:
```html
<div data-component="SettingsPanel" data-source="src/ui/settings/SettingsPanel.tsx" ...>
```

Use these to locate the source file for any visible UI element. Plugin tests: `npx vitest run --config plugins/vitest.config.js`.

## Conventions

- New code should be TypeScript/TSX under `src/`.
- No `@ts-nocheck` — all files are type-checked.
- Keep machines framework-agnostic where practical.
- Keep effect modules composable and testable.
- Use typed channels for inter-module communication (not CustomEvents).
- Use the persistence service for all localStorage access.
- Route settings mutations through runtimeService.
- Respect import boundaries (run `npm run lint` to verify).

## Submodules

- `src-useq/` and `deps/modulisp/` are submodules.
- Submodule updates require separate commits in those repos.
- For editor-facing firmware truth, treat the `src-useq/` submodule in this repo as authoritative.
- Run `npm run src-useq:status` before firmware-sensitive audits, and cite that pinned commit in follow-up work.
- Promotion and runtime-capability rules live in `docs/RUNTIME_CONTRACT.md`.
- The `src-useq/` submodule contains a WASM interpreter that mirrors the actual firmware interpreter. The frontend uses this WASM build — it must be rebuilt (`npm run build:assets`) when the interpreter source in `src-useq/` changes.
