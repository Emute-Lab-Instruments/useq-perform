---
stability: stable
layer: behavioural
---

# Bootstrap

> Spec: app startup. Counterpart to [MAIN.md](MAIN.md).

## Source files

- `src/main.ts` — entry point; `DOMContentLoaded` trampoline that calls `bootstrap()`
- `src/runtime/bootstrap.ts` — canonical bootstrap owner; `resolveBootstrapPlan` + `bootstrap()` orchestration
- `src/runtime/startupContext.ts` — URL param parsing, environment capability detection (`StartupFlags`, `EnvironmentCapabilities`)
- `src/runtime/appLifecycle.ts` — `createApp()`: UI mount, transport wiring, clock start, visualisation init
- `src/runtime/configManager.ts` — config loading and settings hydration
- `src/runtime/appSettingsRepository.ts` — persisted settings load/save
- `src/runtime/runtimeService.ts` — runtime session announcements post-bootstrap
- `src/runtime/runtimeDiagnostics.ts` — `seedBootstrapDiagnostics()` + `publishDiagnosticsSnapshot()`, `reportBootstrapFailure()`
- `src/runtime/browserWasmRuntime.ts` — configured-intent → actual Worker availability, crash recovery, disposal
- `src/runtime/wasmRuntimeWorkerPort.ts` — sole production Worker/WASM preload and request adapter
- `src/runtime/bootstrapRecoverySurface.ts` — framework-independent actionable startup recovery UI

1.1 The shipped product is a single Vite bundle. Loading the app runs `bootstrap()` in a deterministic order: load persisted settings → eagerly start (but do not await) Worker/WASM load (§1.5) → parse URL params + detect environment → seed runtime session with actual availability → mount UI → wire transport → start app lifecycle. Settings load and Worker preload begin before URL parsing; UI/hardware startup never awaits the preload.

1.2 **The app must reach an interactive editor regardless of hardware presence or WASM readiness.** A user with no hardware and a slow WASM load still sees a usable editor with their last code restored. (see `src/runtime/appLifecycle.ts`)

1.3 Cold-start startup must be **observable**: any failure during bootstrap publishes a structured `bootstrapFailure` diagnostic and the user sees an actionable message, never a silent blank page. Application-root failure and Worker/ABI failure use a framework-independent DOM recovery surface because Solid may be unavailable. See [MAIN.md §2.4](MAIN.md).

1.4 **Browser support floor**: a modern ES2020 browser that can run the bundle and the WASM module. Hardware mode additionally requires Web Serial (Chromium-family). When Web Serial is unavailable, the app stays usable in browser-local WASM mode rather than failing, but clearly alerts the user — currently via a non-blocking console message ("Web Serial is unavailable. Browser-local uSEQ is ready, and hardware can be paired later from a supported browser."). When both Web Serial *and* browser-local WASM are unavailable the app instead shows a blocking modal ("Browser Runtime Required"). (see `src/runtime/startupContext.ts` for `isWebSerialAvailable`, `src/runtime/appLifecycle.ts` for the alert paths)

1.4.1 **Automated coverage is Chromium-first.** The deterministic full E2E suite runs against Playwright's pinned Chromium. Release candidates must additionally pass a browser-local ModuLisp eval through the production Worker/WASM bundle in a currently installed Chrome, Chromium, or Edge (`npm run test:browser-local-eval`); this second lane exists because newly exposed WebAssembly/ArrayBuffer APIs can change the generated Emscripten runtime path without changing application source. Other Chromium-family browsers and non-Chromium browsers are best-effort. Visual or behavioural regressions specific to non-Chromium browsers are bugs but not release blockers.

1.5 **Eager Worker preload.** Production WASM loading begins early through `browserWasmRuntime` + `wasmRuntimeWorkerPort`, but bootstrap does not await it before UI mount or hardware reconnect. The coordinator publishes WASM availability only after the Worker handshake. ABI mismatch is fatal to browser-local activation, not to mounting the editor: its typed diagnostic remains visible while the app truthfully degrades to `hardware` or `none`. The direct `wasmInterpreter.ts` loader is witness/test-only.
