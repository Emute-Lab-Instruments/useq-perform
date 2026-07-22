# uSEQ Perform

Web-based live coding interface for uSEQ hardware and the browser-local uSEQ WASM runtime.

## Build and Run

- `npm run dev` - starts config server, static server, and watch builds.
- `npm run build` - builds the interpreter and osc/sine NodeDef WASM artefacts, copies non-code assets, and builds Vite bundles to `public/solid-dist/`.
- `npm run build:wasm` - requires Emscripten (`emcc`) and generates both `src-useq/wasm/useq.{js,wasm}` and `src-useq/wasm/osc_sine.wasm`.
- `npm run build:assets` - copies the generated WASM artefacts and other non-code assets; it fails if a required WASM source is missing.
- `npm run start` - serves `public/` on port `5000`.
- `npm run storybook` - Storybook dev server.
- `npm run build-storybook` - static Storybook build.
- `npm run grammar-lab` - interactive motor-grammar research artifact on port `5566`.
- `npm run build:grammar-lab` - build the portable Grammar Lab into `grammar-lab/dist/`.

## Tests and Typecheck

- `npm run test:mocha` - JavaScript integration tests in `test/**/*.mjs`, including the structural YAML runner.
- `npm run test:unit` - Vitest unit/component/contract-style tests (`unit` project).
- `npm run test:all` - runs Mocha + Vitest unit tests.
- `npm test` - alias for `npm run test:all`.
- `npm run typecheck` - TypeScript check for the modern typed boundary (`src/lib`, `src/machines`, selected `src/utils`, and selected `src/ui` TSX components).
- `npm run src-useq:status` - print the authoritative `src-useq` submodule repo/branch/commit metadata the editor currently depends on.

Testing styles:

- JS/TS tests (`*.test.ts`, `*.test.tsx`, `test/**/*.mjs`) are best for module behaviour, contracts, component rendering, async effects, runtime/transport boundaries, and focused executable assertions.
- YAML tests (`test/new_structural/*.yaml`) are best for data-driven editor command scenarios: command sequences, cursor/focus movement, source edits, and bug-capture cases that should be easy for agents to extend.

## Source Layout

- `src/` - application source (TypeScript/TSX).
- `src/ui/` - Solid UI components, styles, and visualisation renderer.
- `src/ui/adapters/` - imperative adapters for mounting Solid UI components.
- `src/editors/` - CodeMirror extensions, keymaps, themes, gamepad control.
- `src/runtime/` - bootstrap, settings repository, config manager, startup context.
- `src/transport/` - serial port lifecycle, protocol drivers, stream parser.
- `scripts/build-assets.mjs` - markdown/reference/wasm/font asset pipeline.
- `src-useq/` - firmware submodule.
- `grammar-lab/` - standalone interactive laboratory for comparing experimental keyboard/gamepad motor grammars without touching production state.

`src-solid/`, `src/islands/`, and `src/legacy/` have been removed after migration consolidation.

## Architecture

The application uses a single-bundle Vite build. The bundle starts at `src/main.ts`, loads configuration, mounts the UI shell, and then prefers browser-local WASM startup by default while reconnecting saved hardware opportunistically unless the user opts out. UI components are mounted via adapter modules that provide imperative APIs (for example `mountSettingsPanel()` and `showModal()`).

Read `MAP.md` first for a terse codebase index, and `ALIGNMENT.md` for the dated diagnosis of where the codebase currently falls short of its mission.

Product scope, stable core, compatibility cuts, and out-of-scope items live in `docs/specs/MAIN.md` §4. Read that before treating old panels, dormant runtime modes, or stale docs as supported product surface.

Editor-facing firmware and WASM capability rules live in `docs/specs/runtime-contract.md`. Read that before auditing `src-useq` behavior or promoting standalone firmware work into the submodule.

## Task Tracking (Ergo)

This repo uses **`ergo`** for all durable task tracking. `ergo` is the
coding-work CLI over the Holon EAV substrate and replaced Beads (`bd`) on
**2026-06-15**. Beads and its Dolt backend are **frozen read-only** historical
infrastructure — do not set up or sync against them for current work.

The `ergo` CLI is installed at `/home/w1n5t0n/.local/bin/ergo`. The required
environment (`HOLON_TOKEN`, `HOLON_CORE_URL`, optional `HOLON_PRINCIPAL`) is
loaded for every shell by `~/.zshenv` sourcing `~/.secrets/env`.

```bash
ergo ready              # unblocked open work
ergo ready --mine       # filtered to your principal
ergo show <id>          # inspect a task
ergo create "Title" --type task --priority 1 --body "..."
ergo claim <id>         # mark in progress under your principal
ergo done <id> --reason "..."   # close (--reason is mandatory)
```

Do **not** create Markdown TODO lists for durable work. The authoritative
workflow lives in `/home/w1n5t0n/agents/skills/ergo/SKILL.md`.

`docs/BEADS_BACKEND.md` is retained only as **explicitly archival** reference
for the historical Beads/Dolt setup.

## Dev-Mode Component Labels

During `npm run dev`, every Solid component's root element is automatically annotated with `data-component` and `data-source` attributes via a Babel plugin (`plugins/babel-solid-label.cjs`). These are stripped from production builds.

Inspect any element in browser devtools to see the component name and source file path — useful for navigating the codebase or giving AI coding agents a precise pointer.

## URL Parameters

- `?config=<url>` - load a user configuration JSON file.
- `?noModuleMode=true` - force the internal no-module/browser-local debug path.
- `?disableWebSerial=true` - force browser-local containment even in a Web Serial-capable browser.
- `?devmode=true` - enable internal debug/dev tooling.
- `?nosave` - do not read/write local storage.
- `?gist=<id-or-url>` - load editor code from a GitHub gist.
- `?txt=<url>` - load editor code from a plain-text URL.

## License

[MIT](LICENSE)
