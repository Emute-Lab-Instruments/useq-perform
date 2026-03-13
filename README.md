# uSEQ Perform

Web-based live coding interface for uSEQ hardware and the browser-local uSEQ WASM runtime.

## Build and Run

- `npm run dev` - starts config server, static server, and watch builds.
- `npm run build` - copies non-code assets and builds Vite bundles to `public/solid-dist/`.
- `npm run start` - serves `public/` on port `5000`.
- `npm run storybook` - Storybook dev server.
- `npm run build-storybook` - static Storybook build.

## Tests and Typecheck

- `npm run test:mocha` - legacy/browser integration tests in `test/**/*.mjs`.
- `npm run test:unit` - Vitest unit tests (`unit` project).
- `npm run test:all` - runs Mocha + Vitest unit tests.
- `npm test` - alias for `npm run test:all`.
- `npm run typecheck` - TypeScript check for the modern typed boundary (`src/lib`, `src/machines`, selected `src/utils`, and selected `src/ui` TSX components).
- `npm run src-useq:status` - print the authoritative `src-useq` submodule repo/branch/commit metadata the editor currently depends on.

## Source Layout

- `src/` - typed application modules and modern UI components.
- `src/legacy/` - the current production entrypoint and retained runtime modules.
- `src/ui/` - Solid UI components mounted from the legacy runtime.
- `src/ui/adapters/` - imperative adapters for mounting Solid UI components.
- `scripts/build-assets.mjs` - markdown/reference/wasm/font asset pipeline.
- `src-useq/` - firmware submodule.

`src-solid/` and `src/islands/` have been removed after migration consolidation.

## Architecture

The application uses a single-bundle Vite build. The live bundle still starts at `src/legacy/main.ts`, loads configuration, mounts the UI shell, and then prefers browser-local WASM startup by default while reconnecting saved hardware opportunistically unless the user opts out. UI components are mounted via adapter modules that provide imperative APIs (for example `mountSettingsPanel()` and `showModal()`).

Read `docs/REPO_MAP.md` first before treating older folders, heartbeat artifacts, or retained legacy modules as the current architectural truth.

The reset scope and compatibility cuts live in `docs/STABLE_CORE.md`. Read that before treating old panels, dormant runtime modes, or stale docs as supported product surface.

Editor-facing firmware and WASM capability rules live in `docs/RUNTIME_CONTRACT.md`. Read that before auditing `src-useq` behavior or promoting standalone firmware work into the submodule.

## Beads Backend

This repo uses the Dolt-backed Beads backend. Shared connection defaults live in `.beads/config.yaml`, while machine-specific overrides should stay local in `.beads/metadata.json` or `BEADS_DOLT_*` environment variables.

See `docs/BEADS_BACKEND.md` for the supported backend options, the repo's chosen defaults, and the remaining remote-sync setup step.

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
