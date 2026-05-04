# useq-perform Semantics

> Implementation-agnostic semantic spec for the `useq-perform` web app.
> Describes the live-coding interface as the user experiences it and as any
> conforming implementation must behave. The current SolidJS + Vite +
> CodeMirror 6 frontend is one implementation candidate; this document
> defines what the app *means* and what tests must verify.
>
> Counterpart to `../../src-useq/docs/specs/MAIN.md` (language semantics) and
> [runtime-contract.md](runtime-contract.md) (runtime/firmware contract). Where this doc and
> those disagree on a point of app behaviour, this doc wins by intent —
> bring implementation into line and file the bug.
>
> This is the **main spec**. It holds the frame, app-wide failure and
> performance contracts, the stable compatibility surface, cross-cutting
> open questions, and an index of feature-specific sub-specs (§6). Each
> sub-spec is self-contained and numbered from 1.1.

### Source files (architectural roots)

- `src/main.ts` — application entry point
- `src/runtime/bootstrap.ts` — startup order, eager preload, browser support, recovery
- `src/runtime/startupContext.ts` — URL params, startup flags
- `src/runtime/runtimeService.ts` — sole settings mutation surface
- `src/runtime/runtimeSessionService.ts` — runtime session lifecycle (connect/disconnect/swap)
- `src/runtime/wasmInterpreter.ts` — WASM interpreter bridge (eval, diagnostics, sampling)
- `src/lib/typedChannel.ts` — typed pub/sub channel primitive
- `src/contracts/` — channel registries and capability contracts
- `src/lib/persistence.ts` — localStorage persistence service
- `src/effects/editorEvaluation.ts` — eval dispatch, diagnostics push, inline results

---

## 1. Frame

1.1 `useq-perform` is the web live-coding interface for the uSEQ eurorack module. Single-user web app; one editor session, one transport, one visualisation surface, one help/settings panel set.

1.2 The product use case is a performer typing ModuLisp expressions and pressing an eval key while a runtime produces voltages or visualisations. The app is shaped by that constraint: feedback latency must be low; the editor must keep working across hardware disconnects, eval errors, and runtime swaps; nothing the user types should ever be silently lost. Visual feedback and structural control of the code are paramount for user experience.

1.3 The app talks to **two interchangeable runtime shapes**: real uSEQ hardware over Web Serial (firmware ≥ 1.2.0, JSON protocol) and an in-browser WASM build of the same interpreter. Both are first-class. The user's code, edits, and evaluations behave the same against either.
&nbsp;&nbsp;&nbsp;&nbsp;1.3.1 By default, if both are connected, the WASM runtime acts as a "visualisation shadow" for the hardware: we let the hardware focus on updating its outputs, and all other visual feedback is sampled by the WASM runtime for performance reasons.

1.4 The user-facing surfaces (in order of prominence): editor, transport toolbar, main toolbar, visualisation panel, console, help panel, settings panel, picker/radial menus, modals, onboarding banner, action palette, keyboard/gamepad-driven discoverability.

---

## 2. Failure Model

App-wide degradation contracts. Cited from feature sub-specs.

2.1 **An eval that fails to compile or evaluate must not stop the app** (see `src/effects/editorEvaluation.ts`, `src/runtime/wasmInterpreter.ts`). The previously active outputs continue running on hardware (per language LKG semantics); on WASM, the prior compiled program continues. The user sees an inline diagnostic and a console message.

2.2 **A runtime disconnect must not lose editor state.** Editor content, console history, settings, and visualisation traces survive a hardware disconnect or a WASM crash.

2.3 **A WASM ABI mismatch is a fatal startup error** with a clear, actionable message. The app surfaces a diagnostic explaining which export is missing or has the wrong signature.

2.4 **Bootstrap failures** publish a structured diagnostic and render a recovery surface (see `src/runtime/bootstrap.ts`); the user is never left with a blank page.

2.5 **Persistence failures** (corrupt JSON, quota exceeded, `localStorage` unavailable) degrade silently to defaults with a console warning (see `src/lib/persistence.ts`). The app remains usable.

2.6 **Network-bound bootstrap features** (`?config=<url>`, `?gist=`, `?txt=`) that fail to fetch produce a clear console error and fall back to local persisted state (see `src/runtime/startupContext.ts`, `src/runtime/bootstrap.ts`).

2.7 **Diagnostic format.** Every diagnostic carries severity (`info`/`warning`/`error`), a category, a source span (when applicable), a human-readable message in plain language, and an optional suggestion with a working example. No jargon ("arity mismatch") in user-facing strings.

2.8 **Diagnostics survive across evals.** Per-output health is queryable and rendered. A successful eval clears prior diagnostics for the affected outputs, not for the whole document.

2.9 **The serial reader and the visualisation renderer must each tolerate the other crashing.** A render-loop exception must not stop the byte stream; a parser error on one channel must not poison the other channels. On any parse error, the stream parser resets to scanning for the next `0x1F` start marker.

2.10 **WASM crash recovery in `both` mode.** If the WASM interpreter crashes while hardware is running, the app silently attempts to reinitialise WASM. On success, resume visualisation shadow mode. On failure, fall back to hardware-only with a console warning. Hardware operation is never interrupted by a WASM failure.

---

## 3. Performance Targets

3.1 **First useful frame** under typical conditions (aspirational, not hard CI gates): editor visible and accepting input within 1 second of bundle load.

3.2 **First eval** latency under typical conditions (aspirational): WASM ready within 2 seconds; hardware ready when the JSON handshake completes (≈ tens of ms on a healthy device, worst case ≈ 6.4 seconds).

3.3 **Visualisation channel target**: 10–20 simultaneous channels at ≥ 30 FPS without dropped frames. Render-frame budget at the upper end of the channel range stays below the rAF interval.

3.4 **Probe sampling overhead**: one WASM call per probe per tick (after batching); probes scale linearly, not multiplicatively, with sample-per-tick count.

3.5 **The hot path (rAF render + sampling tick) never allocates in steady state, never recompiles, never waits on synchronous I/O.** All compilation and serialisation is hoisted to between-tick boundaries.

3.6 **Settings mutations** fan out within one frame. UI subscribers see the new value before the next paint.

---

## 4. Stable Compatibility Surface

4.1 The **stable core** is committed product surface. This section is the source of truth; breaking changes to anything listed here require explicit decision and migration path.

4.2 The stable core comprises:
- Open the app, edit code, evaluate from the main editor.
- Transport controls mapped to the shared runtime command set.
- Connect to hardware over Web Serial; auto-reconnect a saved port (with persisted opt-out).
- Run browser-local WASM by default when hardware is unavailable; complement hardware when both are present.
- A "don't wait for hardware" setting that lets local editing/eval proceed without a connection gate.
- Distinct visual indication of hardware-connected vs WASM-only states.
- Visualisation in both WASM-driven and hardware-streamed modes.
- Internal time (rAF-driven `performance.now`) as the WASM clock when no hardware is present.
- Loading committed config, persisted settings, and retained URL bootstrap overrides.
- Browser MIDI input via Web MIDI API for routing CC/notes into `live-edit` slots (MIDI learn). MIDI output and firmware-side MIDI remain out of scope.
- `live-edit` values: `(live-edit …)` wrapper form, inline widgets, dockable panel, persistence (see [live-edit.md](live-edit.md)).
- Hardware bindings: `(on-press …)` / `(on-release …)` / `(on-button …)` / `(on-toggle …)` wrapper forms binding ModuLisp expressions to hardware switch/encoder events, inline chip widgets, test-fire UX (see [hardware-bindings.md](hardware-bindings.md)).
- CV 1V/oct calibration: full-screen takeover flow that walks the user through tuning each analog output against an external tuner, with per-octave save and flash persistence (see [calibration.md](calibration.md)).

4.3 The stable URL/storage promises in [url-params.md §1.2](url-params.md) and [persistence.md §1.2/§1.3](persistence.md) are part of the stable core.

4.4 **Compatibility cuts** (kept only as bridges, may shrink without replacement): `?noModuleMode=true` (dev/debug escape hatch only — not a release-facing compatibility promise; may move or disappear); `?devmode=true` UI surface (panel/UI is internal tooling, not stable public surface); mock controls; Storybook/test harnesses; live-serial visualisation as observation-only (no time-seeking).

4.5 **Out of scope** (not compatibility targets, never returning without a mission case): pre-1.2.0 firmware text-serial protocol, camera workflows, desktop/Electron, virtual gamepad, MIDI output and firmware-side MIDI, ambiguous hybrid runtime states, multi-user/multi-tenant, telemetry.

---

## 5. Open / Deferred (cross-cutting)

Items that span multiple sub-specs. Feature-specific open questions live in the corresponding sub-spec.

5.1 **Behavioural runtime parity.** Whether `(useq-play)` etc. should be contract-tested end-to-end against both runtimes (property tests over both ports) or whether matching the wire protocol is sufficient. Wire parity exists; behavioural parity is open.

5.2 **Hardware-initiated push messages.** The current protocol only allows hardware to push structured state via the `meta` field inside eval responses. Hardware should be able to push messages at its own initiative (e.g. transport state changes, diagnostic alerts) outside of eval request/response cycles. Proposed: unsolicited bare JSON messages (`{...}\n`, no `requestId`) are treated as push notifications from firmware, matching `../../src-useq/docs/specs/wire-protocol.md`.

---

## 6. Sub-Specs

Read each as a self-contained spec. Internal numbering restarts at 1.1.

6.1 [bootstrap.md](bootstrap.md) — startup order, eager preload, browser support, observable failures.

6.2 [runtime-modes.md](runtime-modes.md) — four modes (none/wasm/hardware/both), transitions, indicator distinctness, shared transport command set.

6.3 [url-params.md](url-params.md) — bootstrap URL parameters, precedence, `?nosave` semantics.

6.4 [persistence.md](persistence.md) — localStorage keys, error recovery, schema-versioning rule.

6.5 [settings.md](settings.md) — schema sections, mutation surface, devmode gating, panel layout.

6.6 [editor.md](editor.md) — main vs secondary editors, autosave, theming, bracket protection, gutter, focus rules.

6.7 [code-evaluation.md](code-evaluation.md) — eval strategies, fan-out, diagnostics, inline results, output health, probes.

6.8 [transport.md](transport.md) — state machine, clock policy, indicator.

6.9 [visualisation.md](visualisation.md) — WebGL rendering surface, time axis, lanes, faithful past / projected future, output classification, sampling loop, WASM ABI additions, palette coupling.

6.10 [console.md](console.md) — message types, line limit, animation, auto-scroll, markdown.

6.11 [help.md](help.md) — help tabs (guide/reference/snippets) and onboarding banner.

6.11.1 [user-guide.md](user-guide.md) — detailed guide structure, content principles, and interactive playground expectations.

6.12 [overlays.md](overlays.md) — modals, pickers, radial menus, overlay stack.

6.13 [keybindings.md](keybindings.md) — action registry, profiles/layouts, OS mapping, contexts, chords, palette, modifier hints.

6.13.1 [input-dispatch.md](input-dispatch.md) — command router as the single chokepoint for all editor-directed user intents; policy enforcement architecture; keyboard translator constraints.

6.14 [gamepad.md](gamepad.md) — three-stage pipeline (logical input → gestures + axis → bindings), gesture primitives (tap/hold/held/doubleTap/chord/flick), layered bindings (predicate + transient), eager-with-undo dual-bindings, paradigms (modal-shift / leader / hydra / chord-heavy).

6.15 [themes.md](themes.md) — catalogue, atomic application across editor/chrome/vis, custom themes.

6.16 [reactive-flow.md](reactive-flow.md) — typed-channel invariants, mutation surfaces, import boundaries.

6.17 [probes.md](probes.md) — inline probe widgets and the from-list highlight feature (orthogonal to probe activity).

6.18 [structural-editing.md](structural-editing.md) — focus-primary ontology, Metas layer (annotations on nodes), holes as first-class node kind, algebra of navigation/mutation operations, structural vs insertion modes, multi-cursor.

6.19 [live-edit.md](live-edit.md) — `(live-edit …)` wrapper form, inline knob/slider/toggle/picker widgets, dockable panel with cards, gamepad and MIDI learn flow, persistence and orphan cleanup.

6.20 [hardware-bindings.md](hardware-bindings.md) — `(on-press …)`/`(on-release …)`/`(on-button …)`/`(on-toggle …)` wrapper forms, inline chip widgets, edge detection and queue semantics, test-fire UX.

6.21 [calibration.md](calibration.md) — CV 1V/oct calibration full-screen takeover flow, per-output picker, ±50¢ slider with carry-forward offset, save/abort/error semantics.

6.22 [inspector.md](inspector.md) — same-repo visual review tool for isolated app scenarios and local approval workflow.

6.23 [radial-menu.md](radial-menu.md) — centre-screen double-ring gamepad-driven command surface for picking and applying nouns into the document.

6.24 [zen-mode.md](zen-mode.md) — distraction-free practice environment for structural editing with gamepad or keyboard.

6.25 [state-sync.md](state-sync.md) — WASM↔hardware drift detection and recalibration in `both` mode.

6.26 [state-identity.md](state-identity.md) — hidden/editor-generated IDs for anonymous stateful expressions, linked inactive variants, duplicate-active validation, runtime state-resource schemas, and stateful probe projection.

6.27 [formatting.md](formatting.md) — auto-formatting policy: when the editor reformats (structural mutations only), what "well-formatted" means (width + complexity thresholds, arg-aligned breaking, `do`-block rules), and preservation of user layout intent (inter-top-level whitespace sacred, insertion-mode hands-off).

---

## 7. Cross-References

7.1 `../../MAP.md` — terse codebase index (file/module → one-line description).

7.2 `../../ALIGNMENT.md` — opinionated, dated diagnosis of the gap between the codebase and its mission.

7.3 [runtime-contract.md](runtime-contract.md) — editor↔hardware/WASM capability split, WASM ABI floor.

7.4 `../../src-useq/docs/specs/wire-protocol.md` — serial framing, JSON message shapes (handshake, eval, ping, stream-config).

7.5 [reactive-flow.md](reactive-flow.md) — stores, channels, signals, data flow paths (inventory).

7.6 [keybindings.md](keybindings.md) — full keybinding system architecture.

7.7 `../GLOSSARY.md` — terminology source of truth. Consult before introducing new terms.

7.8 [inspector.md](inspector.md), [user-guide.md](user-guide.md) — sub-surface specs.

7.9 `../../src-useq/docs/specs/MAIN.md` — language semantics (what programs *mean*). Counterpart to this doc.

7.10 `../../src-useq/docs/specs/diagnostics.md` — diagnostic system contract (severity, category, source span, ABI surface). See also `../../src-useq/docs/specs/failure-model.md` for failure semantics (LKG, health states, REPL-vs-output channels).

7.10.1 `../../src-useq/docs/specs/visualisation-projection.md` — WASM-side projection-fork and future-frontier contract used by [visualisation.md](visualisation.md).

7.10.2 [state-identity.md](state-identity.md) — editor↔runtime contract for stable identity of anonymous stateful expressions across live edits, output variants, probes, and hidden eval rewrites.

7.10.3 `../../src-useq/docs/specs/state-identity.md` — runtime/language counterpart for state-resource IDs, cold-eval signal expression results, duplicate-active ID diagnostics, and projection semantics.

7.11 [gamepad-handoff.md](gamepad-handoff.md) — gamepad pipeline rebuild status and handoff notes (working document, not normative).

7.12 [gamepad-browser-test.md](gamepad-browser-test.md) — manual browser test plan for the three-stage gamepad pipeline.

7.13 If this spec disagrees with any of the above on a point of *app behaviour*, **this spec wins** by intent — bring implementation and other docs into line and file the bug. If it disagrees with the actually-deployed app, that is a bug — file it.
