# CLAUDE.md

This file provides guidance to coding agents working in this repository.

**Note**: Use `ergo` for task tracking. Do not use markdown TODO tracking. See `README.md` and `/home/w1n5t0n/agents/skills/ergo/SKILL.md`. (Beads/`bd` and Dolt are frozen read-only historical infrastructure.)

## Project Overview

uSEQ Perform is the web live-coding interface for the uSEQ hardware module. This repo also contains the firmware submodule at `src-useq/`.

**Terminology**: `docs/GLOSSARY.md` is the single source of truth for naming. Consult it before introducing new terms or renaming existing concepts.

**Behavioural specs**: `docs/specs/MAIN.md` is the normative app-behaviour spec. It indexes per-feature sub-specs under `docs/specs/` (bootstrap, runtime modes, eval, transport, probes, visualisation, etc.). These specs define what the app *means* and what tests must verify — where the spec disagrees with the implementation, the spec wins and the implementation is the bug. Consult before changing app behaviour or writing tests.

### Spec Lookup (keyword → file)

Before working on a feature, find and read the relevant spec(s). Match by keyword:

| Keywords | Spec |
|----------|------|
| startup, boot, preload, browser support, recovery, init, loading, first load, splash, app start | `docs/specs/bootstrap.md` |
| runtime mode, wasm, hardware, both, none, connection, indicator, serial, USB, connected, disconnected, offline, status | `docs/specs/runtime-modes.md` |
| url params, ?nosave, ?config, ?gist, query string, deep link, share link, URL | `docs/specs/url-params.md` |
| localStorage, persistence, save, load, schema version, storage, remember, retain, restore, cache | `docs/specs/persistence.md` |
| settings, devmode, settings panel, mutation surface, preferences, config, options, toggles | `docs/specs/settings.md` |
| editor, autosave, bracket, focus rules, secondary editor, CodeMirror, syntax highlighting, line numbers, text editing | `docs/specs/editor.md` |
| gutter, gutter rail, expression gutter, play button, vis toggle, last-evaluated, active rail, failure pulse, stale pulse, exclusive vis, vis.toggleAtHalo, soft sampling | `docs/specs/expression-gutter.md` |
| eval, compile, diagnostics, inline results, output health, run, execute, error, warning, squiggly, red underline, feedback | `docs/specs/code-evaluation.md` |
| transport, play, stop, clock, tempo, state machine, BPM, pause, reset, playback, timing, sync | `docs/specs/transport.md` |
| visualisation, canvas, WebGL, lanes, sampling, waveform, oscilloscope, scope, graph, plot, trace, render, animation, FPS, channels, display | `docs/specs/visualisation.md` |
| console, messages, log, auto-scroll, output, print, debug, terminal, REPL output | `docs/specs/console.md` |
| help, reference, snippets, onboarding, guide, documentation, cheatsheet, examples, intro | `docs/specs/help.md` |
| user guide, lessons, tutorial, playground, learning, walkthrough, interactive, teach, howto | `docs/specs/user-guide.md` |
| modal, picker, overlay stack, popup, dialog, dropdown, menu, floating, z-index, layer | `docs/specs/overlays.md` |
| keybindings, shortcuts, profiles, action registry, contexts, palette, hotkeys, keyboard, mapping, remap, command palette | `docs/specs/keybindings.md` |
| input dispatch, command router, chokepoint, policy, event handling, key handler, action dispatch, intent routing | `docs/specs/input-dispatch.md` |
| which-key, modifier hints, chord pending, modifier overlay, hint popup, key helper, shortcut guide, discoverable | `docs/specs/which-key.md` |
| gamepad, controller, buttons, sticks, gestures, paradigms, hold, tap, Xbox, PlayStation, DualSense, joystick, trigger, bumper, D-pad, analog stick | `docs/specs/gamepad.md` |
| radial menu, noun picker, double-ring, wrap, replace, insert content, pie menu, circular menu, form picker, template, snippet insertion | `docs/specs/radial-menu.md` |
| main menu, pause menu, L3+R3, save/restore, system menu, escape menu, global menu | `docs/specs/main-menu.md` |
| themes, colours, palette, dark, light, appearance, skin, style, accent, colour scheme | `docs/specs/themes.md` |
| reactive flow, typed channels, stores, signals, import boundaries, pub/sub, events, data flow, subscriptions, state management | `docs/specs/reactive-flow.md` |
| probes, from-list, highlight, inline widget, sampling, watch, monitor, inspect value, live value, visualise expression | `docs/specs/probes.md` |
| structural editing, s-expression, halo, focus, grab, holes, navigation, cursor, paredit, AST, tree, node, parent, child, sibling, wrap, unwrap, splice, slurp, barf, raise, select expression | `docs/specs/structural-editing.md` |
| structural fuzzing, fuzz, command dispatch coverage, property testing, random testing, invariant, stress test | `docs/specs/structural-fuzzing.md` |
| formatting, indent, auto-format, line breaking, width, pretty print, layout, whitespace, newlines, alignment, wrapping | `docs/specs/formatting.md` |
| atom, increment, cycle, LB/RB, number editing, joystick scrub, polarity, value editing, bump, nudge, step, symbol cycling, rotate value, next/prev | `docs/specs/atom-manipulation.md` |
| live-edit, knob, slider, toggle, widget, MIDI learn, dockable panel, parameter, control, tweak, real-time edit, CC, fader, continuous control | `docs/specs/live-edit.md` |
| hardware bindings, on-press, on-release, on-button, on-toggle, chip widget, button mapping, switch, encoder, physical control, event binding | `docs/specs/hardware-bindings.md` |
| calibration, 1V/oct, tuning, CV output, per-octave, pitch, tune, voltage, DAC, accuracy, scale | `docs/specs/calibration.md` |
| storybook, dev review, stories, visual testing, screenshot, regression, component review | `docs/specs/storybook.md` |
| zen mode, practice, distraction-free, focus mode, minimal, training, sandbox | `docs/specs/zen-mode.md` |
| state sync, drift, WASM↔hardware, recalibration, mismatch, desync, diverge, reconcile, shadow | `docs/specs/state-sync.md` |
| state identity, stateful expressions, anonymous state, IDs, stable ID, identity tracking, state slot, refactor state | `docs/specs/state-identity.md` |
| runtime contract, WASM ABI, capability split, firmware contract, exports, imports, boundary, API surface, interface | `docs/specs/runtime-contract.md` |
| synthesis, audio engine, sound, standalone, AudioWorklet, worklet, Faust, NodeDef, node card, patch graph, control transport, SAB, audio thread, DSP, voice, browser synth | `docs/specs/synthesis.md` |
| witness, conformance corpus, clause mapping, witness runner, harvest, witnessRef, drift badge | `docs/specs/witnesses.md` |
| engine ledger, living spec, spec tab, clause badge, spec drift, glass compiler, explain trace | `docs/specs/engine-ledger.md` |
| the machine, machine schematic, mental model, how useq thinks, guide chapter 0, six ideas, LKG demo | `docs/specs/the-machine.md` |

**Language/firmware specs** (in `src-useq/docs/specs/`):

| Keywords | Spec |
|----------|------|
| ModuLisp semantics, language overview, Lisp, syntax, grammar | `src-useq/docs/specs/MAIN.md` |
| signal model, implicit lifting, pure functions of time, reactive, continuous, per-sample, functional | `src-useq/docs/specs/signal-model.md` |
| time, phasors, t, t0, ground-time, counters, durations, beat, bar, phrase, section, clock, BPM, tempo, rhythm | `src-useq/docs/specs/time.md` |
| time warps, premap, time-as, fast, slow, offset, speed, rate, multiply, divide, shift, phase | `src-useq/docs/specs/time-warps.md` |
| state, define-state, integrate, cross-sample, UGens, memory, accumulator, feedback, slew, filter, stateful, env-follow | `src-useq/docs/specs/state.md` |
| state identity (runtime), state-resource IDs, projection, stable ID, cold-eval, duplicate-active | `src-useq/docs/specs/state-identity.md` |
| cells, reactivity, define, dependency tracking, cascade, variable, binding, let, assign, reference, name | `src-useq/docs/specs/cells.md` |
| compilation, node graph, compile passes, loop unrolling, compiler, CSE, constant folding, optimisation, DAG, topological | `src-useq/docs/specs/compilation.md` |
| functions, lambda, recursion, variadic, inlining, fn, defun, callable, closure, higher-order, apply | `src-useq/docs/specs/functions.md` |
| values, types, numbers, vectors, nil, truthiness, float, integer, boolean, list, string, data types, numeric | `src-useq/docs/specs/values-types.md` |
| outputs, a1-a8, d1-d8, s1-s8, q0, LKG, active program, analog, digital, voltage, gate out, CV out | `src-useq/docs/specs/outputs.md` |
| prev, cross-output reads, feedback loops, batch, previous value, last sample, read other output, inter-output | `src-useq/docs/specs/prev.md` |
| inputs, gate, CV, switches, encoders, swm, swt, swr, rot, analog in, digital in, potentiometer, external signal | `src-useq/docs/specs/inputs.md` |
| live-edit (runtime), compiler treatment, slot allocation, input slot, externally-driven, set-live-inputs | `src-useq/docs/specs/live-edit.md` |
| top-level forms, eval surface, do block, imperative, REPL, expression, statement, program entry | `src-useq/docs/specs/top-level.md` |
| dialects, reactive vs imperative, mode switching, style, paradigm, sequential, procedural | `src-useq/docs/specs/dialects.md` |
| diagnostics ABI, wire format, error categories, severity, error reporting, warning, hint, suggestion, span | `src-useq/docs/specs/diagnostics.md` |
| failure model, LKG, health states, REPL channels, blame, error recovery, fallback, crash, last known good, graceful | `src-useq/docs/specs/failure-model.md` |
| wire protocol, serial, JSON messages, handshake, framing, USB, CDC, communication, request/response, streaming, 0x1F | `src-useq/docs/specs/wire-protocol.md` |
| firmware, tick loop, hardware variants, boot, flash, embedded, Pico, RP2040, PlatformIO, Arduino | `src-useq/docs/specs/firmware.md` |
| hardware I/O, pins, LED, variants, boot sequence, GPIO, PWM, DAC, ADC, physical | `src-useq/docs/specs/hardware-io.md` |
| visualisation projection, WASM fork, future frontier, prediction, lookahead, speculative, future rendering | `src-useq/docs/specs/visualisation-projection.md` |
| devtools, instrumentation, telemetry, tick profiling, debug, performance, metrics, tracing, observability | `src-useq/docs/specs/devtools.md` |
| synth form, synth nodes, NodeDef, node instance, audio params, instantiate, patching, inline routing, vector voices, rate class, smoothing, fade | `src-useq/docs/specs/synth-nodes.md` |

## Build and Development

- `npm run dev` - runs config server, static server, and watch builds. (`portless useq-perform npm run dev`)
- `npm run build` - `build:assets` then Vite build.
- `npm run watch` - asset + Vite watch builds.
- `npm run storybook` - Storybook dev server.
- `npm run build-storybook` - Build the canonical component/scenario review surface.
- `npm run grammar-lab` - Run the separate motor-grammar research surface.
- `npm run lint` - ESLint with import boundary enforcement.

Build outputs:

- App bundles: `public/solid-dist/` (single `bundle.js` + `bundle.css`)
- Generated assets: `public/assets/` and `public/wasm/`

## Testing

The app uses two test styles: JS/TS tests and YAML command-scenario tests.
Both are first-class tests; there is no legacy/non-legacy split.

- `npm run test:mocha` - Mocha/Chai JavaScript integration tests in `test/**/*.mjs`, including the structural YAML runner.
- `npm run test:unit` - Vitest unit/component tests.
- `npm run test:e2e` - Playwright trusted-input browser journeys (`e2e/`) against the full app + worker-backed WASM runtime; rebuilds WASM/assets/bundle first. Serves `public/` via route interception on `http://localhost` (origin must stay trustworthy or COOP/COEP is ignored and `crossOriginIsolated` breaks).
- `npm run test:contracts` - Vitest contract tests (runtime, UI, transport)
- `npm run test:all` / `npm test` - all suites
- `npm run typecheck` - TypeScript type checking

Storybook stories are also exercised through the Vitest Storybook project in Vite config.

JS/TS tests (`*.test.ts`, `*.test.tsx`, `test/**/*.mjs`) are best for module
behaviour, contracts, component rendering, async effects, runtime/transport
boundaries, and focused executable assertions.

### Structural YAML Regression Tests

The files under `test/new_structural/*.yaml` are a living bug-capture and
semantic-refinement suite. They are best for data-driven editor command
scenarios: command sequences, cursor/focus movement, source edits, and
bug-capture cases that should be easy for agents to extend. When a user reports
or discovers an editor command bug, prefer adding the smallest YAML case that
demonstrates the desired behaviour before or alongside the fix.

Failing YAML rows are not automatically stale expectations. They may mean the
implementation is wrong, the intended semantics have just been refined, or the
spec needs to be updated. Treat each failure as evidence to triage against
`docs/specs/structural-editing.md`, `docs/specs/editor.md`, and the current
command-router behaviour before changing or retiring the row.

## CI

GitHub Actions (`.github/workflows/runtime-contracts.yml`) runs on PRs and pushes to main: typecheck → contract tests → unit tests → Storybook smoke tests → app build → Storybook build → firmware test → assert pinned src-useq status.

## Architecture

### Source of Truth

- Canonical source tree: `src/`
- Entry point: `src/main.ts`
- **Reactive data flow**: `docs/specs/reactive-flow.md` — stores, channels, signals, and data flow paths. Consult before tracing state or adding reactive plumbing.

### Source Layout

- `src/lib/` - shared foundations: settings (schema, normalization, persistence), editor defaults, `CircularBuffer`, debug utilities, editor compartments, editor store, persistence service, gamepad manager, picker menu model
- `src/lib/settings/` - settings split: `schema.ts` (types/defaults), `normalization.ts` (validation/migration), `persistence.ts` (localStorage via persistence service)
- `src/editors/` - CodeMirror extensions, keymaps, themes (data-driven), gamepad navigation, editor keyboard utilities, editor evaluation
- `src/editors/extensions/` - CodeMirror extensions: `structure/` (ast, decorations, eval-integration), `evalHighlight`, `visReadability`, `diagnostics` (inline error squiggles from WASM)
- `src/transport/` - serial port lifecycle, JSON protocol driver, stream parser, serial utilities, connector, firmware upgrade check
- `src/runtime/` - bootstrap, Worker lifecycle/port, runtime coordinator/services, settings repository, startup context, app lifecycle, diagnostics, isolated witness interpreter
- `src/effects/` - side-effect modules: transport policy, editor evaluation, the public visualisation session, its internal sampler/runtime, mock control inputs, websocket server
- `src/machines/` - XState state machines (transport)
- `src/contracts/` - typed channels (runtime, visualisation, gamepad, help), event types, capability contracts
- `src/ui/` - Solid UI components (settings, help, toolbar, modals)
- `src/ui/adapters/` - application-owned wired component trees and imperative state adapters; `ApplicationRoot.tsx` renders them once
- `src/ui/styles/` - application CSS stylesheets
- `src/ui/visualisation/` - WebGL visualisation renderer (`serialVisGL.ts` + `webglLineRenderer.ts`)
- `src/utils/` - reactive stores (settings, console, visualisation, reference, snippets, output health)
- `stories/` - canonical Storybook component/scenario surface; Grammar Lab remains a separate research app

### Key Design Patterns

**Typed Channels** (`src/contracts/*Channels.ts`): All inter-module communication uses typed pub/sub channels from `src/lib/typedChannel.ts`. No CustomEvents for runtime or visualisation events.

**Persistence Service** (`src/lib/persistence.ts`): All localStorage access goes through a central service with typed keys, nosave support, and JSON error recovery.

**Settings Mutation Surface**: All settings mutations go through `runtimeService` (sole mutation surface). External code reads via stores, writes via runtimeService.

**Gamepad Intent Architecture**: Gamepad emits typed intents via channels; separate subscribers handle editor navigation and menu bridging. Zero coupling to UI internals.

**Visualisation Pipeline**: Production consumers enter through `visualisationSession`. Hardware time/store updates are synchronous; Worker sampling, projections, probes, and drift resync are best-effort shadow work. The session owns the rAF/render hook, probe access, state-sync, and teardown lifetime.

**Import Boundaries**: Enforced via ESLint (`eslint.config.js`). `src/lib/` and `src/contracts/` must not import from higher layers.

**Dependency Injection for Extensions**: CodeMirror extensions that depend on runtime behavior use a Config interface + factory pattern instead of importing concrete Workers/stores. Each extension declares exactly the capabilities it needs; the default probe config routes through `visualisationSession`. This keeps extensions isolated in tests and Storybook.

**Props-Based UI Components**: UI components that previously imported singletons (stores, services, adapters) have been refactored to accept data and callbacks as props. The adapter layer (`src/ui/adapters/`) creates "Wired" wrapper components that read from real singletons and pass them as props. This makes components testable and renderable in isolation. Applied to: MainToolbar, TransportToolbar, ProgressBar, Modal, VisLegend, GeneralSettings (+ sub-panels), HelpPanel, KeyboardVisualiser.

**Diagnostic System**: The WASM interpreter produces structured diagnostics (errors, warnings, hints) with source spans, human-readable messages, and suggestions. These flow from C++ through the WASM ABI to the editor as CodeMirror inline annotations.

- `src/editors/extensions/diagnostics.ts` — CodeMirror state field that accumulates diagnostics across evals. Diagnostics persist per-range until that range is re-evaluated successfully. `pushDiagnostics()` adds diagnostics with document offset mapping; `clearDiagnosticsForRange()` removes diagnostics for a specific range.
- `src/utils/outputHealthStore.ts` — SolidJS reactive store tracking per-output health (`idle`/`running`/`fallback`/`error`). Polled per animation frame via `useq_active_diagnostics()`. Success feedback with auto-fade.
- `src/runtime/wasmRuntimeWorkerPort.ts` — sole production WASM port; reads diagnostics inside the Worker and transports typed results to the main thread.
- `src/runtime/wasmInterpreter.ts` — direct loader reserved for isolated witness/integration execution; production does not import it.
- `src/effects/editorEvaluation.ts` — after each eval, reads diagnostics, pushes them to the editor with correct document offsets, shows error messages inline instead of `"{error}"`.
- `src/contracts/wasmAbi.ts` — `useq_last_diagnostics` and `useq_active_diagnostics` as optional WASM exports.

Full spec: `src-useq/docs/specs/diagnostics.md`. See also `src-useq/docs/specs/failure-model.md` for failure semantics (LKG, health states).

## UI Lifetime

`src/ui/ApplicationRoot.tsx` is the one production Solid render owner. Wired trees from `src/ui/adapters/` are children/portals of that root and expose imperative state operations (`showModal()`, menu/panel visibility, toolbar state) without creating new roots. `app.stop()` disposes the visualisation/Worker lifetimes before disposing the application root.

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
- Promotion and runtime-capability rules live in `docs/specs/runtime-contract.md`.
- The `src-useq/` submodule contains a WASM interpreter that mirrors the actual firmware interpreter. The frontend uses this WASM build — it must be rebuilt (`npm run build:assets`) when the interpreter source in `src-useq/` changes.
