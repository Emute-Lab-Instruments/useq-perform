# UX and E2E audit — 2026-07-22

## Read this first

**Mission:** make ModuLisp feel like a playable instrument: fast authoring,
clear cause-and-effect feedback, and continuous output even while code is wrong.
`useq-perform` owns the human interaction loop; pinned `src-useq` owns language,
runtime, safety, and hardware/WASM semantics.

**Verdict:** both codebases have unusually strong semantic and subsystem tests.
They did not have a trustworthy full-app test proving that real user input reaches
the production command route, worker, and compiled virtual firmware. This audit
adds the first two such journeys.

## Load-bearing assumptions and decisions

- **Two codebases means this repo plus its pinned `src-useq/` submodule.** A
  standalone firmware clone is advisory; the clean pin at `0ef4078` is the tested
  source of truth.
- **The browser-local runtime is a product, not a mock.** It runs the same C++
  interpreter compiled to WASM behind a worker-backed `WasmRuntimePort`.
- **“E2E” starts with trusted browser input.** Calling handlers, dispatching
  synthetic `KeyboardEvent`s, or invoking the dev eval helper does not prove the
  keymap/router path. Playwright keyboard input does.
- **“Correct system behavior” needs two observations.** Assert a user-visible
  frontend effect and sample the actual WASM output. DOM-only or runtime-only
  assertions are insufficient.
- **Keep the existing virtual firmware.** The missing axe edge was orchestration,
  not another emulator. The only added seam is a dev-only read of an output via
  the active production runtime port.
- **Last-known-good is a UX invariant.** An invalid live edit must show a useful
  error while the prior signal keeps running.
- **Hardware parity is not claimed by browser E2E.** Browser E2E proves the WASM
  product path. Native firmware, wire-contract, and later hardware-in-loop lanes
  remain distinct because serial framing, boot races, and electrical I/O are real
  hardware concerns.

## UX report: `useq-perform`

### What is strong

- The product model is coherent: one editor, one command vocabulary, four
  explicit runtime modes, and a shared port abstraction.
- Structural editing has deep semantic coverage: data-driven journeys, malformed
  trees, holes, navigation boundaries, clipboard flows, grab/cancel, and seeded
  fuzzing.
- Feedback is treated as interaction infrastructure: eval flashes, inline
  results, persistent diagnostics, output-health rails, visualisation history and
  projection, console messages, modifier hints, and motor-practice surfaces.
- Keyboard and gamepad converge on action IDs and the command router. This is the
  right seam for input-source parity.
- Inspector and Storybook provide broad isolated visual states, including many
  error and edge states.

### What still weakens the experience

1. **The whole feedback loop was previously unproven.** Most tests enter below
   the browser-event boundary or replace runtime dependencies with spies.
2. **Basic journeys are less protected than advanced internals.** There are
   thousands of assertions for structure, synthesis, and stores, but no default
   browser gate for “type a signal, evaluate it, see feedback, hear/observe the
   result.”
3. **Visual correctness is curated, not regression-gated.** Inspector scenarios
   and Storybook stories are valuable review inventory, but the default test
   command runs neither the Storybook browser project nor image comparisons.
4. **Accessibility is component-local.** Some semantics and an a11y addon exist,
   but keyboard focus order, overlay trapping/restoration, announcements, reduced
   motion, and contrast are not tested as full journeys.
5. **Test output contains avoidable noise.** Expected localStorage and runtime
   warnings make novel failures harder to notice.
6. **The strategic diagnosis is stale.** `ALIGNMENT.md` says its last full pass
   was 2026-05-05 and still describes already-landed work as pending. Treat it as
   historical evidence until refreshed.

## UX report: pinned `src-useq`

### What is strong

- The core promise is user-shaped: compile/runtime failures must not stop the
  music; diagnostics explain the fault; healthy outputs remain independent.
- Native firmware tests cover inputs, signal chains, tempo changes, rhythm,
  dependency propagation, flash round-trips, memory stress, multi-output
  isolation, time warps, playback, and sub-millisecond tick budgets.
- The suite includes fuzzing, ABI checks, generated NodeDef WASM smoke tests,
  transactional synthesis compilation, resource reclamation, state identity,
  and projection isolation.
- A coverage ledger maps specifications to strict, warning-only, missing, and
  deferred coverage. That honesty is more valuable than a raw percentage.

### Meaningful gaps

- The ledger still identifies 24 implemented-but-uncovered semantic clauses.
  The most UX-critical are diagnostic persistence, LKG binding freezing,
  cascading-failure health, batch `prev`, multiple diagnostics, diagnostic rate
  limiting, physical switch/encoder inputs, and variant-gated input errors.
- Native E2E starts at harness calls, not wire bytes from the real frontend.
- WASM and native firmware are not run through a shared behavioral corpus for the
  six common transport commands and representative language programs.
- Hardware-only risks require a later hardware-in-loop lane: boot timing, serial
  framing under real backpressure, reconnects, calibration, ADC/DAC behavior,
  switches/encoder edges, and flash on target.

## Test-suite assessment

| Layer | Basic UX | Advanced / edge UX | Main limitation |
|---|---|---|---|
| Solid/jsdom components | Good controls and callbacks | Some overlays, persistence, and failure states | No layout, trusted events, browser focus, audio, worker, or real WASM |
| Structural YAML + fuzz | Excellent editing basics | Excellent malformed trees, boundaries, undo/cancel, random sequences | Starts at editor commands, below physical input routing |
| Gamepad/menu integration | Good full logical pipeline | Chords, layers, eager undo, radial auto-chain | Fake polling plus mocked eval/UI dependencies in jsdom |
| Runtime/transport contracts | Strong modes, fan-out, protocol, races | Timeouts, reconnect, stale responses, ABI drift | Ports/backends are usually fakes |
| Storybook + Inspector | Broad visual inventory | Rich isolated states | Not part of `npm test`; little journey or screenshot gating |
| `src-useq` native suite | Strong signal and playback semantics | Excellent LKG, stress, isolation, fuzz, state/resource cases | Begins below the actual browser/wire boundary |
| New Playwright lane | Real typing, keymap, router, worker, WASM, visible feedback | Invalid edit plus visible error and LKG continuity | WASM only; intentionally not hardware-in-loop |

### Current executable baseline

- `npm run test:mocha`: **353 passing, 8 pending, 2 failing**. Both failures are
  malformed-document structural navigation semantics and should be triaged, not
  papered over.
- `npm run test:unit`: **3,850 passing, 1 skipped** across 184 files.
- `meson test -C src-useq/build`: **25/25 targets passing**, including native
  firmware E2E and fuzz.
- `npm test` currently stops after the two Mocha failures and therefore does not
  run Vitest. CI should report both lanes even when one fails.
- `npm run test:e2e`: the pinned WASM and production bundle build, and Playwright
  discovers both journeys. Chromium cannot launch inside this managed sandbox
  (`sandbox_host_linux.cc: Operation not permitted`), so browser execution is
  **not claimed green here**; run it on the host or a browser-capable CI runner.

## E2E proposal and first slice

### Test topology

```text
trusted key / pointer / gamepad input
  -> browser + CodeMirror
  -> action resolver / command router
  -> editor evaluation + feedback
  -> worker-backed WasmRuntimePort
  -> compiled src-useq WASM
  -> sampled output / diagnostics / transport state
```

The Playwright lane serves the built `public/` tree through an intercepted
`http://useq.test` browser origin. It applies the production COOP/COEP headers
without binding a local port, so workers, WASM streaming, and
`crossOriginIsolated` behavior remain browser-real and the suite also runs in
restricted agent containers.

### Landed in this slice

1. Type `(a1 0.25)`, press the real `Alt+Enter` binding, observe an inline
   result, and sample `a1 == 0.25` from the active WASM port.
2. Establish `(a1 0.75)`, submit an unknown function, observe both CodeMirror
   lint and inline error feedback, and prove `a1` remains at `0.75`.

### Next slices, in priority order

1. Transport buttons and keyboard/gamepad parity for play/pause/stop/rewind.
2. Rapid successive evals: newest response wins and stale diagnostics cannot
   overwrite it.
3. Structural keyboard and virtual-gamepad journeys through the command router,
   including cancel/undo and radial-menu auto-chain.
4. Visualisation journey: evaluated output appears, history remains faithful,
   and invalid edit marks the frontier without rewriting the past.
5. Persistence/reload, `?nosave`, unsupported capability, worker failure/recovery,
   and offline asset failures.
6. Shared behavioral corpus executed against native firmware and WASM.
7. Optional hardware-in-loop smoke lane for release candidates; do not burden
   every local run with nondeterministic hardware dependencies.

## Explicit non-claims

- No hands-on visual browser review was possible in this session because the
  in-app browser was unavailable.
- Passing headless Chromium does not prove audio quality, Web Serial hardware,
  calibration accuracy, or frame-time performance on the demo machine.
- This report does not reinterpret open specs as implemented features.
