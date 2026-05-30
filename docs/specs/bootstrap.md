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
- `src/runtime/wasmInterpreter.ts` — WASM module preload and instantiation

1.1 The shipped product is a single Vite bundle. Loading the app runs `bootstrap()` in a deterministic order: load persisted settings → eagerly start WASM load (§1.5) → parse URL params + detect environment → seed runtime session → mount UI → wire transport → start app lifecycle. (see `src/runtime/bootstrap.ts`, `src/main.ts`) Settings load and WASM preload run before URL parsing: the config loader reads the small set of boot-relevant URL params (`?nosave`, `?config`) directly when hydrating settings, and the WASM preload is deliberately kicked off as early as possible so the first eval does not pay the full cold-start.

1.2 **The app must reach an interactive editor regardless of hardware presence or WASM readiness.** A user with no hardware and a slow WASM load still sees a usable editor with their last code restored. (see `src/runtime/appLifecycle.ts`)

1.3 Cold-start startup must be **observable**: any failure during bootstrap publishes a structured `bootstrapFailure` diagnostic and the user sees an actionable message, never a silent blank page. See [MAIN.md §2.4](MAIN.md). (see `src/runtime/runtimeDiagnostics.ts`)

1.4 **Browser support floor**: a modern ES2020 browser that can run the bundle and the WASM module. Hardware mode additionally requires Web Serial (Chromium-family). When Web Serial is unavailable, the app stays usable in browser-local WASM mode rather than failing, but clearly alerts the user — currently via a non-blocking console message ("Web Serial is unavailable. Browser-local uSEQ is ready, and hardware can be paired later from a supported browser."). When both Web Serial *and* browser-local WASM are unavailable the app instead shows a blocking modal ("Browser Runtime Required"). (see `src/runtime/startupContext.ts` for `isWebSerialAvailable`, `src/runtime/appLifecycle.ts` for the alert paths)

1.4.1 **Automated coverage is Chromium-first.** Browser-local mode is exercised in CI against Chromium; other Chromium-family browsers and non-Chromium browsers are best-effort. Visual or behavioural regressions specific to non-Chromium browsers are bugs but not release blockers.

1.5 **Eager WASM preload.** WASM loading begins early in bootstrap so the first eval does not pay the full cold-start. Failure to preload does not block UI mount; the first eval will await load if necessary. (see `src/runtime/wasmInterpreter.ts`, `src/runtime/bootstrap.ts`)
