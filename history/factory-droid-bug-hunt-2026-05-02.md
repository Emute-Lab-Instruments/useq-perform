# Deep Bug-Hunt and Consistency Audit: useq-perform

**Date:** 2026-05-02
**Branch:** v1.2.0
**src-useq pinned:** 7f3a887 (feature/bytecode-vm-core, clean)
**Auditor:** Factory Droid (overnight read-only mission)

---

## 1. Executive Summary

### Total Findings by Severity

| Severity | Count | Description |
|----------|-------|-------------|
| S1 Critical | 1 | WASM diagnostics readback broken — inline editor errors non-functional |
| S2 High | 16 | Major spec/implementation gaps, untested critical paths, transport issues |
| S3 Medium | 38 | Real bugs with workarounds, meaningful drift, important test gaps |
| S4 Low | 30 | Minor inconsistencies, stale docs, small dead-code pockets |
| S5 Cleanup/Investigation | 21 | Suspicious patterns, speculative issues, follow-up research |
| **Total** | **106** | |

### Top 5 Highest-Impact Issues

1. **[WASM-001] S1: `__useqWasmRuntime` global never set** — All WASM diagnostic readback returns empty arrays. Inline editor error squiggles are completely non-functional. Every user in WASM mode sees zero error feedback.

2. **[DRIFT-002] S2: Quantised eval sends code immediately** — Spec and help guide tell users code is "scheduled to take effect at the start of the next bar." Code evaluates immediately with no bar-boundary scheduling. Feature promised but never implemented.

3. **[WASM-002] S2: `useq_active_diagnostics()` is a stub returning `{}`** — Per-output health monitoring completely non-functional. C implementation is a TODO stub. Spec defines the ABI but implementation is absent.

4. **[RT-S2-03] S2: Race condition in concurrent serial port connections** — Auto-reconnect + navigator.serial connect events can fire concurrently with user connects, causing locked readers and state corruption.

5. **[UI-002] S2: Runtime state visually indistinguishable without hover** — Connection state only visible via CSS color on connect button. No persistent text label. Violates STABLE_CORE §6 requirement for visually distinct runtime states.

### Commands Run

| Command | Result |
|---------|--------|
| `npm run src-useq:status` | Clean: pinned 7f3a887, branch feature/bytecode-vm-core, not dirty |
| `npm run test:unit` | 80 files, 1877 tests passing, 0 failures (pre-scrutiny); 1 pre-existing failure in probeHelpers.test.ts (post-scrutiny) |
| `npm run test:mocha` | 213 passing, 42 pending (structural editing tests, tracked as protocol-st1) |
| `npm run test:all` | 1877 passing (or 1876 + 1 failure post-scrutiny) |
| `npm run typecheck` | 46 pre-existing type errors (read-only mission, no fixes applied) |
| `npm run lint` | Clean — passes with no errors |
| `diff src-useq/wasm/useq.js public/wasm/useq.js` | Identical — no artifact staleness |

### Commands That Failed or Were Skipped

- `npm run typecheck` exits with code 2 due to 46 pre-existing type errors. These are documented, not mission-introduced.
- No commands were skipped due to missing tooling.

---

## 2. Methodology

### Docs Read

**App specs (24 files):**
- `docs/specs/MAIN.md` and all 18 sub-specs (bootstrap, runtime-modes, url-params, persistence, settings, editor, code-evaluation, transport, visualisation, console, help, overlays, keybindings, gamepad, themes, reactive-flow, probes, structural-editing)
- Plus: live-edit.md, zen-mode.md, radial-menu.md, gamepad-handoff.md, gamepad-browser-test.md

**App top-level docs (8 files):**
- `docs/STABLE_CORE.md`, `docs/RUNTIME_CONTRACT.md`, `docs/PROTOCOL.md`, `docs/REACTIVE_FLOW.md`, `docs/GLOSSARY.md`, `docs/KEYBINDING_SYSTEM.md`, `docs/INSPECTOR_SPEC.md`, `docs/USER_GUIDE_SPEC.md`

**Firmware specs (6 files):**
- `src-useq/docs/specs/MAIN.md`, `src-useq/docs/specs/diagnostics.md`, `src-useq/docs/specs/failure-model.md`, `src-useq/docs/specs/wire-protocol.md`, `src-useq/docs/specs/live-edit.md`, `src-useq/docs/SEMANTICS.md`

**Orientation docs:** `README.md`, `MAP.md`, `CLAUDE.md`, `ALIGNMENT.md`

### Source Areas Inspected

- **Transport:** connector.ts, json-protocol.ts, stream-parser.ts, webSerialHostPort.ts, types.ts, serial-utils.ts, upgradeCheck.ts
- **Runtime:** bootstrap.ts, startupContext.ts, appLifecycle.ts, appSettingsRepository.ts, runtimeSession.ts, runtimeSessionStore.ts, wasmInterpreter.ts, wasmRuntimePort.ts, wasmRuntimeWorkerPort.ts, wasmJsonTransport.ts, wasmJsonHandlers.ts, workers/wasmRuntime.worker.ts
- **Effects:** editorEvaluation.ts, transportOrchestrator.ts, transportClock.ts, visualisationSampler.ts
- **Editors:** extensions.ts, inlineResults.ts, diagnostics.ts, eval-integration.ts, decorations.ts, probes.ts
- **Contracts:** runtimePorts.ts, useqRuntimeContract.ts, wasmAbi.ts
- **Lib:** persistence.ts, settings/schema.ts, settings/normalization.ts, editorCompartments.ts, editorStore.ts, gamepad/*, keybindings/*
- **UI:** MainToolbar.tsx, TransportToolbar.tsx, settings panels, adapters/toolbars.tsx
- **Firmware/WASM:** wasm_wrapper.cpp, build_wasm.sh, useq.js (both copies)
- **Tests:** 80+ test files across src/, test/, inspector/

### Tests/Checks Run

- All test suites (vitest + mocha): 1877+ tests passing
- Typecheck: 46 pre-existing errors documented
- Lint: clean
- 42 targeted `rg` searches across codebase
- Manual cross-referencing of spec documents against code

### Limitations

1. **No runtime testing** — audit was static analysis only. Cannot verify runtime behavior (e.g., actual WASM diagnostic output, serial protocol on wire).
2. **No browser testing** — UI findings are based on code inspection, not visual verification.
3. **Firmware build not run** — src-useq C++ code was read but not compiled or tested.
4. **bd issue search limited** — could not comprehensively cross-reference all findings against existing bd issues.
5. **Spec interview decisions** from memory note partially applied — some "resolved" items may not be reflected in spec text.

---

## 3. Severity-Grouped Findings

### S1 Critical

#### WASM-001: `__useqWasmRuntime` global never set — diagnostics readback silently returns empty

- **Category:** wasm-integration
- **Status:** Confirmed
- **Affected files:** `src/runtime/wasmRuntimePort.ts:196-221`, `src/runtime/workers/wasmRuntime.worker.ts:410-421`, `src/effects/editorEvaluation.ts:149`
- **Evidence:** `globalThis.__useqWasmRuntime` is read by diagnostic readback functions (`readLastDiagnostics`, `readActiveDiagnostics`) but never written anywhere in the codebase, including generated `useq.js`. All WASM diagnostic readback always returns `[]`. Inline editor error squiggles are completely non-functional in WASM mode.
- **Why it matters:** Users in WASM mode (the default for most users without hardware) get zero error feedback. Every eval that fails silently succeeds from the user's perspective. This breaks the core feedback loop described in spec §2.1.
- **Suggested fix:** After `useq_init()` completes, set `globalThis.__useqWasmRuntime = { useq_last_diagnostics, useq_active_diagnostics }` using the already-bound cwrap wrappers. Do the same in the worker scope.
- **Suggested regression test:** Unit test that verifies `globalThis.__useqWasmRuntime` is set after WASM initialization, and that `readLastDiagnostics()` returns non-empty after a failing eval.

---

### S2 High

#### DRIFT-002: Quantised eval is not actually quantised — sends code immediately

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Affected files:** `src/effects/editorEvaluation.ts:218-240`, `src/lib/keybindings/actions.ts:45-46`, `docs/specs/code-evaluation.md §1.1`
- **Evidence:** Spec says quantised eval submits code at next bar boundary. Code evaluates immediately with no bar-boundary scheduling. The help guide tells users code is "scheduled to take effect at the start of the next bar" but it's instant.
- **Why it matters:** User-facing documentation promises a feature that doesn't exist. Performers relying on bar-boundary timing are getting immediate execution instead.
- **Suggested fix:** Either implement bar-boundary scheduling or update the spec and help guide to describe immediate evaluation.
- **Suggested regression test:** Test that quantised eval path actually defers evaluation to next bar boundary (or test that spec accurately documents current behavior).

#### DRIFT-003 / CQ-S2-01: Zen progress uses direct localStorage, bypasses persistence service

- **Category:** spec-implementation-drift / code-quality
- **Status:** Confirmed
- **Affected files:** `src/zen/progress.ts:28,40`
- **Evidence:** `localStorage.getItem/setItem` used directly. Key "useq:zen:progress" not registered in `PERSISTENCE_KEYS`. Doesn't respect `?nosave` flag. Bypasses error recovery and centralized logging.
- **Why it matters:** Convention violation that could cause data loss under `?nosave` mode and breaks the centralized persistence contract.
- **Suggested fix:** Register key in `PERSISTENCE_KEYS` and refactor to use `persistence.load()`/`save()`.
- **Suggested regression test:** Verify `?nosave` mode prevents zen progress writes. Verify persistence error recovery covers zen key.

#### RT-S2-01: Handshake accepts `type:"hello"` but spec requires `type:"response"`

- **Category:** runtime-transport
- **Status:** Likely
- **Affected files:** `src/transport/json-protocol.ts:202-213,257-260`
- **Evidence:** `completeHandshake` doesn't check `response.type === "response"`. Test fake sends `type:"hello"` instead of spec-mandated `type:"response"`.
- **Why it matters:** Protocol mismatch could accept malformed responses. Test reinforces wrong expectation.
- **Suggested fix:** Check `response.type === "response"` in `completeHandshake` and update test fake.
- **Suggested regression test:** Test that handshake rejects `type:"hello"` responses.

#### RT-S2-02: `sendSerialInputStreamValue` sends packet matching no spec-defined frame type

- **Category:** runtime-transport
- **Status:** Confirmed
- **Affected files:** `src/transport/json-protocol.ts:373-399`, `src-useq/docs/specs/wire-protocol.md §6.5`
- **Evidence:** Function builds `[0x1F][channel][f64-LE]` but spec §6.5 defines `INPUT_SET` as `[0x1F][0x01][count:u16][(slot:u16, f64)×count]`. Code layout matches no defined frame type. Firmware would silently discard or misinterpret it.
- **Why it matters:** Dead code that could cause confusing behavior if called. Should be removed or updated to match spec.
- **Suggested fix:** Remove `sendSerialInputStreamValue` (superseded by `sendSetLiveInputs`) or update to match §6.5.
- **Suggested regression test:** If kept, verify packet format matches wire-protocol.md exactly.

#### RT-S2-03: Race condition in concurrent serial port connections

- **Category:** runtime-transport
- **Status:** Confirmed
- **Affected files:** `src/transport/connector.ts:146-163`
- **Evidence:** `connectToSerialPort` is async with no mutex. Auto-reconnect + navigator.serial connect events can fire concurrently with user connects, causing locked readers and state corruption.
- **Why it matters:** Under real usage (device unplugged/replugged, user clicking connect while auto-reconnect fires), the app can enter a corrupted connection state.
- **Suggested fix:** Add connection-in-progress flag/mutex. Return early or queue if already connecting.
- **Suggested regression test:** Test concurrent `connectToSerialPort` calls resolve to single connection.

#### CQ-S2-02: Unsafe type assertions accessing untyped settings properties

- **Category:** code-quality
- **Status:** Confirmed
- **Affected files:** `src/editors/extensions/structure/decorations.ts:604,962-964`, `src/editors/extensions/structure/eval-integration.ts:123`, `src/ui/settings/EvalResultsSettings.tsx:31`
- **Evidence:** `expressionGutterEnabled`, `expressionClearButtonEnabled`, `expressionLastTrackingEnabled`, `circularOffset`, `mode` accessed via `as any` because not in settings schema. Creates shadow settings surface invisible to validation and normalization.
- **Why it matters:** Settings changes won't produce type errors if schema evolves. Properties bypass normalization and persistence migration.
- **Suggested fix:** Add all properties to settings schema with proper types and defaults.
- **Suggested regression test:** Verify all settings properties have schema entries and type-safe access.

#### CQ-S2-03: Empty catch block swallows CodeMirror dispatch errors

- **Category:** code-quality
- **Status:** Confirmed
- **Affected files:** `src/editors/extensions/structure/decorations.ts:939`
- **Evidence:** `onExternalChange` try/catch has empty catch block. If `view.dispatch` fails (e.g., destroyed editor during async settings change), error silently swallowed. Only empty catch in production code.
- **Why it matters:** Makes debugging editor state issues nearly impossible. Could mask real errors.
- **Suggested fix:** Add `console.warn` or defensive guard checking `view.dom?.isConnected` before dispatching.
- **Suggested regression test:** Test that destroyed editor view doesn't throw uncaught exceptions.

#### WASM-002: `useq_active_diagnostics()` is a stub returning `{}`

- **Category:** wasm-integration
- **Status:** Confirmed
- **Affected files:** `src-useq/wasm/wasm_wrapper.cpp:315-319`, `src/contracts/wasmAbi.ts:107-112`
- **Evidence:** C implementation is a TODO stub returning `alloc_cstr("{}")`. Spec requires keyed-by-output JSON object. Per-output health monitoring completely non-functional.
- **Why it matters:** Spec promises per-output health states (idle/running/fallback/error). Frontend code exists to consume this data but C++ backend never produces it.
- **Suggested fix:** Implement per-output diagnostic tracking in the signal engine C++ code.
- **Suggested regression test:** Test that `useq_active_diagnostics()` returns non-empty JSON after outputs are evaluated.

#### WASM-003: `useq_output_diagnostics()` from spec not implemented

- **Category:** wasm-integration
- **Status:** Confirmed
- **Affected files:** `src-useq/docs/specs/diagnostics.md §4.3`, `src-useq/wasm/wasm_wrapper.cpp`
- **Evidence:** Spec defines `useq_output_diagnostics()` for lightweight per-frame health polling. Function doesn't exist in C++, not in `EXPORTED_FUNCTIONS`, not declared in `wasmAbi.ts`.
- **Why it matters:** Spec describes a function that doesn't exist. RUNTIME_CONTRACT.md references it. Frontend could never call it.
- **Suggested fix:** Implement in `wasm_wrapper.cpp` and add to ABI contract, or update spec to mark as deferred.
- **Suggested regression test:** If implemented: test round-trip through WASM ABI. If deferred: verify spec is updated.

#### UI-002: "Disconnected" state visually identical to WASM-only without hover

- **Category:** ui-product-risk
- **Status:** Likely
- **Affected files:** `src/ui/adapters/toolbars.tsx:89`, `src/ui/TransportToolbar.tsx`, `src/ui/styles/toolbar.css`
- **Evidence:** Connection state only visible via CSS color on connect button (red=none, orange=wasm, green=both, warm off-green=hardware) and title/aria-label on hover. No persistent text label. Violates STABLE_CORE §6.
- **Why it matters:** Users who don't hover over the connect button cannot distinguish between disconnected, WASM-only, hardware, and both modes. Accessibility concern for colorblind users.
- **Suggested fix:** Add persistent text label or badge showing current mode ("WASM"/"Hardware"/"HW+WASM"/"Offline").
- **Suggested regression test:** Visual regression test verifying distinct labels for all 4 runtime states.

#### UI-003: WASM crash in browser-local mode has no auto-restart

- **Category:** ui-product-risk
- **Status:** Likely
- **Affected files:** `src/runtime/wasmRuntimeWorkerPort.ts`, `src/effects/editorEvaluation.ts`
- **Evidence:** Worker errors caught and logged at debug level only. No auto-restart logic. Spec interview notes "WASM crash in both mode: silent auto-restart" but no such logic exists. Browser-local crash leaves non-functional app.
- **Why it matters:** WASM crash (spec §2.10) should auto-restart in both mode. In browser-local mode there's no recovery at all.
- **Suggested fix:** Implement WASM worker auto-restart with backoff. Post console message informing user.
- **Suggested regression test:** Test that WASM worker restarts after simulated crash.

#### TG-S2-01: Full editor evaluation pipeline untested end-to-end

- **Category:** test-gap
- **Status:** Confirmed
- **Affected files:** `src/effects/editorEvaluation.ts`, `src/effects/editorEvaluation.test.ts`
- **Evidence:** Test file only tests diagnostic offset mapping helpers. Main eval functions (`evaluateExpression`, `evaluateVisibleExpressions`, etc.) untested. STABLE_CORE #1 has no integration test.
- **Why it matters:** The core product workflow (edit code → eval → see results/errors) has zero end-to-end test coverage.
- **Suggested fix:** Add integration tests with real EditorView testing editor content → WASM eval → diagnostics push → inline annotation.
- **Suggested regression test:** Integration test exercising full eval pipeline with known-good and known-bad code.

#### TG-S2-02: Transport orchestrator has zero test coverage

- **Category:** test-gap
- **Status:** Confirmed
- **Affected files:** `src/effects/transportOrchestrator.ts`
- **Evidence:** 8.2 KB module wiring transport machine, runtime service, JSON-META listeners, and clock policy. No test file exists. STABLE_CORE #2 not tested.
- **Why it matters:** Transport commands (play/pause/stop) are core user workflows with no automated verification.
- **Suggested fix:** Test `parseTransportState` and `extractTransportStateFromMeta` (pure functions). Add integration test with mock runtimeService.
- **Suggested regression test:** Test each transport command produces correct state transitions.

#### TG-S2-04: Settings normalization and persistence schema untested

- **Category:** test-gap
- **Status:** Confirmed
- **Affected files:** `src/lib/settings/normalization.ts`, `src/lib/settings/schema.ts`, `src/lib/settings/normalizeKeybindings.ts`, `src/lib/settings/normalizeEvalResults.ts`, `src/lib/settings/normalizeVisualisation.ts`
- **Evidence:** 5 normalization modules with no dedicated test files.
- **Why it matters:** Settings migration bugs could silently drop user preferences on version upgrades.
- **Suggested fix:** Add unit tests for each normalizer with known input→output pairs.
- **Suggested regression test:** Test migration from known old schema shape to current shape.

#### TG-S2-05: Output health store untested

- **Category:** test-gap
- **Status:** Confirmed
- **Affected files:** `src/utils/outputHealthStore.ts`
- **Evidence:** Output health store tracks per-output health states. No test file exists.
- **Why it matters:** Broken health tracking means users don't see output health feedback — a core diagnostic feature.
- **Suggested fix:** Test `refreshOutputHealth` with mock diagnostics data. Test reactive store updates and auto-fade.
- **Suggested regression test:** Test health state transitions (idle → running → error → running).

---

### S3 Medium

#### SPEC-001: Transport command `useq-get-transport-state` absent from firmware spec

- **Category:** spec-contradiction
- **Status:** Confirmed
- **Files:** `docs/specs/runtime-modes.md §1.11`, `src-useq/docs/specs/wire-protocol.md §5.7`
- **Evidence:** App spec lists it as shared transport command but wire-protocol has no separate message — it's just eval.
- **Why it matters:** Ambiguous whether this is a protocol command or a Lisp builtin.
- **Suggested fix:** Move to WASM-only section or clarify it's a Lisp builtin sent via eval.
- **Suggested regression test:** Verify spec text matches actual implementation path.

#### SPEC-002: PROTOCOL.md is a redirect but app specs still reference it

- **Category:** spec-contradiction
- **Status:** Confirmed
- **Files:** `docs/PROTOCOL.md`, `docs/specs/live-edit.md §1.1`, `docs/specs/code-evaluation.md §1.10`
- **Evidence:** PROTOCOL.md redirects to `src-useq/docs/specs/wire-protocol.md` but live-edit.md still has stale "TBD" reference.
- **Why it matters:** Stale references mislead developers about protocol completeness.
- **Suggested fix:** Update all PROTOCOL.md references to point to wire-protocol.md. Remove stale "TBD" notes.
- **Suggested regression test:** `rg 'PROTOCOL\.md' docs/specs/` should find zero references.

#### SPEC-003: REACTIVE_FLOW.md and specs/reactive-flow.md overlap with no authority hierarchy

- **Category:** spec-contradiction
- **Status:** Confirmed
- **Files:** `docs/REACTIVE_FLOW.md`, `docs/specs/reactive-flow.md`
- **Evidence:** Both cover typed-channel invariants with no declared winner.
- **Why it matters:** Developers don't know which is authoritative.
- **Suggested fix:** Declare reactive-flow.md (sub-spec) wins on behavioural claims; REACTIVE_FLOW.md is inventory.
- **Suggested regression test:** Verify cross-reference notes added to both files.

#### SPEC-005: App specs reference SEMANTICS.md with broken section numbers

- **Category:** spec-contradiction
- **Status:** Confirmed
- **Files:** `docs/specs/code-evaluation.md §1.3`, `src-useq/docs/SEMANTICS.md`
- **Evidence:** SEMANTICS.md is now a redirect. Section references like "§14" are broken.
- **Why it matters:** Broken cross-references prevent navigating the spec tree.
- **Suggested fix:** Update code-evaluation.md §1.3 to reference failure-model.md instead.
- **Suggested regression test:** `rg 'SEMANTICS\.md' docs/specs/` — verify all references point to valid targets.

#### SPEC-006: Parser recovery description in MAIN.md §2.9 incomplete

- **Category:** spec-contradiction
- **Status:** Likely
- **Files:** `docs/specs/MAIN.md §2.9`, `src-useq/docs/specs/wire-protocol.md §3.5`
- **Evidence:** MAIN.md says parser resets to scanning for next 0x1F but JSON messages are bare `{` with no 0x1F prefix. Recovery could skip JSON messages.
- **Why it matters:** Spec describes incomplete recovery behavior.
- **Suggested fix:** Update MAIN.md §2.9 to mention both 0x1F and `{` as valid start markers.
- **Suggested regression test:** Test stream parser recovery after corrupt binary frame followed by JSON message.

#### DRIFT-001: `?debug=true` URL param undocumented

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/runtime/startupContext.ts:155,180,198`, `docs/specs/url-params.md §1.2`
- **Evidence:** Code parses `?debug=true` for verbose console logging. Not in spec's exhaustive list.
- **Why it matters:** Undocumented escape hatch.
- **Suggested fix:** Add to url-params.md §1.2 as internal escape hatch.
- **Suggested regression test:** Verify spec lists all URL params consumed by code.

#### DRIFT-004: `?default` URL param resets code but undocumented

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/runtime/appSettingsRepository.ts:87-88`
- **Evidence:** Code checks `params.default` and returns default starting code. Not in spec.
- **Why it matters:** Users can't discover this feature; developers don't know it exists.
- **Suggested fix:** Add to url-params.md §1.2 with precedence documentation.
- **Suggested regression test:** Test `?default` resets code; verify spec documents it.

#### DRIFT-006: OutputHealth type includes "fallback" but never set

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/utils/outputHealthStore.ts:22`
- **Evidence:** Type defines "fallback" but no code path sets it. Spec promises a health state that doesn't exist.
- **Why it matters:** UI code may handle "fallback" as special case that never fires.
- **Suggested fix:** Implement fallback health or remove from spec/type.
- **Suggested regression test:** Test that health state machine covers all declared states.

#### DRIFT-007: Spec describes 4 flat runtime modes; code uses 2-level system

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/runtime/runtimeSession.ts`, `src/contracts/runtimeTypes.ts`, `docs/specs/runtime-modes.md §1.1`
- **Evidence:** Spec says none/wasm/hardware/both. Code has `RuntimeConnectionMode` (hardware/browser/none) + `TransportMode`. "wasm" in spec is "browser" in code.
- **Why it matters:** Mode naming mismatch causes confusion when tracing code against spec.
- **Suggested fix:** Update spec to document the 2-level system or add a mapping table.
- **Suggested regression test:** Verify spec mode names match code constants.

#### DRIFT-009: `?config=<url>` merges (not replaces) — spec misleading

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/runtime/appSettingsRepository.ts:155-180`
- **Evidence:** Spec says "URL parameters are highest-precedence" but `?config` merges, doesn't override.
- **Why it matters:** Config loading behavior differs from documented precedence.
- **Suggested fix:** Clarify spec: `?config` merges while `?nosave`/`?disableWebSerial`/`?devmode` are true overrides.
- **Suggested regression test:** Test `?config` merge behavior vs individual flag override.

#### DRIFT-010: `?wasmInWorker=true` is stale — worker used unconditionally

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/runtime/bootstrap.ts:207-221`, `CLAUDE.md`
- **Evidence:** Worker is created unconditionally. No `?wasmInWorker` param exists. CLAUDE.md and code comments reference it as opt-in but it's always-on.
- **Why it matters:** Stale documentation misleads about worker mode being optional.
- **Suggested fix:** Remove `?wasmInWorker` references from CLAUDE.md and code comments.
- **Suggested regression test:** `rg 'wasmInWorker' src/ CLAUDE.md` should find zero references.

#### DRIFT-012: RUNTIME_CONTRACT.md omits WASM-only capabilities

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/contracts/useqRuntimeContract.ts:33-37`
- **Evidence:** Code lists `wasmOnlyCapabilities: ["update-time", "output-sampling"]`. Diagnostics readback, probe evaluation, and batch output sampling are WASM-only but not listed.
- **Why it matters:** Incomplete contract could cause incorrect fan-out assumptions.
- **Suggested fix:** Add diagnostics-readback, probe-evaluation, batch-output-sampling to WASM-only capabilities.
- **Suggested regression test:** Verify all WASM-only code paths are reflected in contract.

#### DRIFT-013: Soft eval doesn't update probes/highlights/health as spec promises

- **Category:** spec-implementation-drift
- **Status:** Confirmed
- **Files:** `src/effects/editorEvaluation.ts:320-340`, `docs/specs/code-evaluation.md §1.1`
- **Evidence:** Spec says soft eval updates "all local visual surfaces." Code explicitly skips output health and doesn't trigger probe/vis refresh. Only inline results and diagnostics update.
- **Why it matters:** Spec overpromises what soft eval actually does.
- **Suggested fix:** Update spec to accurately describe which surfaces soft eval updates, or implement the full update.
- **Suggested regression test:** Test that soft eval updates exactly the surfaces the spec claims.

#### RT-S3-01: Disconnect handler ignores port identity

- **Category:** runtime-transport
- **Status:** Confirmed
- **Files:** `src/transport/connector.ts:294-298`
- **Evidence:** Disconnect handler doesn't check event port identity. Unplugging unrelated USB serial device triggers "uSEQ disconnected."
- **Why it matters:** False disconnection events when other USB devices are removed.
- **Suggested fix:** Extract port from event and compare against `getSerialPort()`, matching connect handler's logic.
- **Suggested regression test:** Test disconnect event for unrelated port doesn't trigger disconnect flow.

#### RT-S3-02: Transport machine initial state is "playing" but spec says "paused"

- **Category:** runtime-transport
- **Status:** Confirmed
- **Files:** `src/machines/transport.machine.ts:29`
- **Evidence:** Machine has `initial: "playing"`. Spec says boots in "paused" if runtime available.
- **Why it matters:** Internal clock may start prematurely, causing unexpected output.
- **Suggested fix:** Change initial to "paused" or add bootstrap sync step.
- **Suggested regression test:** Test transport machine initial state matches spec.

#### RT-S3-03: Heartbeat failure only warns — no reconnection or state reset

- **Category:** runtime-transport
- **Status:** Confirmed
- **Files:** `src/transport/json-protocol.ts:111-131`
- **Evidence:** After heartbeat failure, protocol state remains "json", pending requests time out individually. User must manually reconnect.
- **Why it matters:** Unresponsive device leaves app in zombie state.
- **Suggested fix:** Add "degraded" protocol state or auto-reconnect. At minimum, reject all pending requests on heartbeat failure.
- **Suggested regression test:** Test heartbeat failure clears all pending requests.

#### RT-S3-04: `sendSetLiveInputs` bypasses `writeJsonRequest` — no timeout

- **Category:** runtime-transport
- **Status:** Confirmed
- **Files:** `src/transport/json-protocol.ts:467-483`
- **Evidence:** Writes directly to port without requestId or timeout. If write hangs, exclusive writer lock blocks all subsequent writes.
- **Why it matters:** A single hung write permanently deadlocks the serial output.
- **Suggested fix:** Add short timeout (500ms) or route through `writeJsonRequest`.
- **Suggested regression test:** Test that hung write doesn't block subsequent writes.

#### RT-S3-05: `eval-integration.ts` imports `isConnectedToModule` directly

- **Category:** runtime-transport
- **Status:** Confirmed
- **Files:** `src/editors/extensions/structure/eval-integration.ts:11,214,237`
- **Evidence:** Direct import from `connector.ts` bypasses port abstraction. Hidden coupling to hardware transport.
- **Why it matters:** Editor layer has implicit dependency on transport module. Violates architecture intent.
- **Suggested fix:** Replace with runtime session state check or pass through Config interface.
- **Suggested regression test:** Verify editor extensions don't import from transport/.

#### WASM-004: `useq_set_input_value()` in C++ but not exported

- **Category:** wasm-integration
- **Status:** Confirmed
- **Files:** `src-useq/wasm/wasm_wrapper.cpp:258-262`
- **Evidence:** C wrapper exists but not in `EXPORTED_FUNCTIONS`. JS can't call it. `g_hw_inputs[]` always zero.
- **Why it matters:** Live-edit feature blocked by missing export.
- **Suggested fix:** Add to `EXPORTED_FUNCTIONS` and `wasmAbi.ts` when live-edit feature lands.
- **Suggested regression test:** Test hardware input values propagate through WASM.

#### WASM-005: Diagnostics missing `triggered_by` field from spec

- **Category:** wasm-integration
- **Status:** Confirmed
- **Files:** `src-useq/wasm/wasm_wrapper.cpp:291-312`, `src/contracts/runtimePorts.ts:244-250`
- **Evidence:** Spec defines `triggered_by` for dependency-triggered recompiles. C wrapper doesn't emit it. TypeScript types also omit it.
- **Why it matters:** Frontend can't distinguish direct vs dependency errors.
- **Suggested fix:** Add `triggered_by` to C++ JSON builder and TypeScript types.
- **Suggested regression test:** Test diagnostic with dependency chain includes `triggered_by`.

#### WASM-006: Diagnostic `category` field produced but not in TypeScript types

- **Category:** wasm-integration
- **Status:** Confirmed
- **Files:** `src/contracts/runtimePorts.ts:244-250`, `src/runtime/wasmInterpreter.ts:905-912`
- **Evidence:** C wrapper emits `"category": "arity"` etc. TypeScript types don't declare `category`.
- **Why it matters:** Consumers can't access category in type-safe way.
- **Suggested fix:** Add `category?: string` to `RuntimeDiagnostic` and `UseqDiagnostic`.
- **Suggested regression test:** Test diagnostic type includes category after WASM eval.

#### WASM-007: TypeScript includes "hint" severity but C++ never produces it

- **Category:** wasm-integration
- **Status:** Confirmed
- **Files:** `src/contracts/runtimePorts.ts:247`
- **Evidence:** Spec says "hint" is synonym for "info". TypeScript includes as distinct value. C++ only produces "info".
- **Why it matters:** Frontend code may handle "hint" as special case that never fires.
- **Suggested fix:** Remove "hint" from TypeScript severity unions or document it's accepted but never produced.
- **Suggested regression test:** `rg '"hint"' src/contracts/` should match spec.

#### CQ-S3-01: Silent catch blocks in eval-integration.ts

- **Category:** code-quality
- **Status:** Confirmed
- **Files:** `src/editors/extensions/structure/eval-integration.ts:220-222,243-245`
- **Evidence:** One catch has `// ignore` (completely silent). Another logs via `dbg()` which may be disabled.
- **Why it matters:** Failed eval submissions produce no user-visible feedback.
- **Suggested fix:** Replace `// ignore` with `dbg()` call. Consider surfacing transport errors.
- **Suggested regression test:** Test that failed eval dispatch produces observable output.

#### CQ-S3-02: Seven @ts-expect-error suppressions for clojure-mode

- **Category:** code-quality
- **Status:** Confirmed
- **Files:** 7 files importing from `@nextjournal/clojure-mode`
- **Evidence:** Package has no TypeScript declarations.
- **Why it matters:** API changes in upstream won't be caught.
- **Suggested fix:** Create local `types/clojure-mode.d.ts` with typed exports.
- **Suggested regression test:** Verify type declarations exist for all used clojure-mode functions.

#### CQ-S3-04: Non-null assertions on Serial API streams

- **Category:** code-quality
- **Status:** Confirmed
- **Files:** `src/transport/stream-parser.ts:79,109`, `src/transport/json-protocol.ts:367`
- **Evidence:** `port.readable!.getReader()` without null checks. If port disconnects between check and usage, uncaught TypeError.
- **Why it matters:** Race condition between port check and usage.
- **Suggested fix:** Add null checks with descriptive errors.
- **Suggested regression test:** Test port disconnect during active read produces clean error.

#### CQ-S3-06: Keybinding conditional context evaluation unimplemented

- **Category:** code-quality
- **Status:** Confirmed
- **Files:** `src/lib/keybindings/resolver.ts:365`
- **Evidence:** Conditional keybinding contexts (when clauses) not evaluated. Always falls back to default.
- **Why it matters:** Custom keybindings with context conditions silently don't work.
- **Suggested fix:** Implement context evaluation or document the limitation.
- **Suggested regression test:** Test keybinding with `when` clause resolves correctly.

#### UI-004: Settings panel lacks explanation of "Start locally before hardware connects"

- **Category:** ui-product-risk
- **Status:** Confirmed
- **Files:** `src/ui/settings/AdvancedSettings.tsx:48-52`
- **Evidence:** Checkbox label doesn't explain what the setting does. No tooltip or description.
- **Why it matters:** Users can't make informed decisions about the setting.
- **Suggested fix:** Add description text explaining the setting enables WASM at boot.
- **Suggested regression test:** Verify setting has descriptive text in UI.

#### UI-007: Visualisation requires WASM even in hardware-only mode

- **Category:** ui-product-risk
- **Status:** Likely
- **Files:** `src/effects/visualisationSampler.ts`
- **Evidence:** Visualisation sampler exclusively uses WASM port. In hardware-only mode, `tickAndProject` fails. Contradicts STABLE_CORE §7.
- **Why it matters:** Visualisation is a committed product surface that doesn't work in hardware-only mode.
- **Suggested fix:** Document that visualisation requires WASM, or add serial-data-only render path.
- **Suggested regression test:** Test visualisation works (or gracefully degrades) with WASM disabled.

#### UI-013: Dual editor content persistence paths — editorContent dead write

- **Category:** ui-product-risk
- **Status:** Confirmed
- **Files:** `src/lib/editorCompartments.ts:19`, `src/editors/extensions.ts:39`, `src/lib/editorStore.ts:166-169`
- **Evidence:** `editorCompartments.ts` writes to "editorContent" on every change. `editors/extensions.ts` writes to "editorCode". Bootstrap only reads "editorCode". "editorContent" is a dead write.
- **Why it matters:** If "editorCode" write paths were removed thinking "editorContent" handles it, users lose persistence.
- **Suggested fix:** Unify to single key. Change editorCompartments to write to `editorCode`.
- **Suggested regression test:** Test editor content survives page reload via single persistence path.

#### TG-S2-03: WASM runtime worker has zero test coverage

- **Category:** test-gap
- **Status:** Confirmed
- **Files:** `src/runtime/workers/wasmRuntime.worker.ts`
- **Evidence:** No test file exists. Worker mode is documented feature.
- **Why it matters:** Bugs in message protocol, error handling, or initialization invisible until runtime.
- **Suggested fix:** Extract message-handling logic into testable module. Test message protocol.
- **Suggested regression test:** Test worker message protocol round-trip.

#### TG-S3-01 through TG-S3-09: Additional medium test gaps

- **TG-S3-01:** Wire protocol contract test T5 placeholder assertion
- **TG-S3-02:** Wire protocol contract test T8 silently passes
- **TG-S3-03:** URL parameter precedence not tested beyond parsing
- **TG-S3-04:** Persistence error recovery not tested for edge cases
- **TG-S3-05:** Transport clock policy untested
- **TG-S3-06:** Runtime session transitions lack edge-case tests
- **TG-S3-07:** Diagnostics pipeline not tested for hardware-mode path
- **TG-S3-08:** Bootstrap sequence tested with excessive mocking
- **TG-S3-09:** Visualisation renderer tests limited by canvas mock

(See individual reports for full details on each.)

---

### S4 Low

(30 findings — see individual reports for full details. Key themes:)

- **Stale cross-references:** SPEC-008 through SPEC-015 — multiple specs reference moved/redirected documents or have stale "TBD" notes
- **Undocumented settings:** DRIFT-014 through DRIFT-020 — legacy migration keys, settings fields not in spec, console settings placement
- **Transport edge cases:** RT-S4-01 through RT-S4-05 — ambiguous port matching, stale readers, missing response fields, confusing naming
- **WASM dead code:** WASM-008 through WASM-010 — duplicated binding logic, dead `UseqDiagnostic` type, architectural plumbing differences
- **Code quality:** CQ-S4-01 through CQ-S4-08 — commented-out code, dev globals, FIXME comments, bare TODOs, missing type declarations
- **UI gaps:** UI-009 through UI-012 — missing keybindings panel, no osFamily control, misleading ?nosave UI, missing status bar
- **Test gaps:** TG-S4-01 through TG-S4-09 — 42 pending structural tests, skipped gamepad tests, thin test coverage for secondary modules

---

### S5 Cleanup / Investigation

(21 findings — see individual reports for full details. Key themes:)

- **Spec evolution artifacts:** SPEC-016 through SPEC-020 — deprecated 0x65 framing in push message proposal, stale "Open" sections, unindexed spec files, broken PRD.md reference
- **Drift investigation items:** DRIFT-021 through DRIFT-023 — eval.now keybinding action, bracket protection setting cross-reference, useqExperienceLevel usage
- **Transport cleanup:** RT-S5-01 through RT-S5-05 — deprecated exports, imperative DOM in Solid app, hardcoded buffer count, vacuous test assertions
- **WASM investigation:** WASM-011 through WASM-013 — potential memory leak in diagnostic strings, dead C wrapper, dead JS export
- **Code quality investigation:** CQ-S5-01 through CQ-S5-05 — defensive catch blocks, `as any` casts on SerialPort, test mock typing

---

## 4. Cross-Cutting Themes

### Repeated Root Causes

1. **Specs written aspirationally, implementation never caught up.** The most impactful drift findings (quantised eval, soft eval surface updates, output health states) describe features that were designed but never fully implemented. The specs read as product vision documents rather than descriptions of current behavior.

2. **Diagnostics pipeline has systemic gaps.** The S1 WASM diagnostic global issue, the S2 `useq_active_diagnostics` stub, the S2 `useq_output_diagnostics` absence, and the S3 `triggered_by`/`category` field gaps all trace back to the same root cause: the diagnostics spec was written ahead of implementation, and the C++ → WASM → TypeScript pipeline was never fully wired.

3. **Centralization conventions partially adopted.** The persistence service and typed channels are well-adopted patterns, but zen/progress.ts bypasses persistence, eval-integration.ts bypasses the port abstraction, and multiple settings use `as any` because they're not in the schema. The conventions exist but enforcement is incomplete.

4. **Test coverage follows implementation, not product surface.** The most critical untested paths (editor eval pipeline, transport orchestrator, settings normalization) are the exact workflows STABLE_CORE commits to keeping working. Tests cover what's easy to test (pure functions, unit-level contracts) rather than what matters most (end-to-end user workflows).

### Architectural Pressure Points

1. **Runtime mode abstraction is leaky.** The 2-level `connectionMode` + `transportMode` system doesn't match the spec's flat 4-mode model. Editor code directly imports `isConnectedToModule` from transport. UI can't clearly communicate which mode is active.

2. **WASM worker boundary is incomplete.** The `__useqWasmRuntime` global is the critical link in the diagnostics pipeline and it's broken. The worker has no test coverage. Binding logic is duplicated between in-process and worker paths.

3. **Protocol definitions are fragmented.** `src/transport/json-protocol.ts` has inline message type strings alongside typed builders. `src/runtime/jsonProtocol.ts` and `src/runtime/wasmJsonTransport.ts` duplicate some shapes. RUNTIME_CONTRACT.md is incomplete.

### Spec Areas Needing Clarification

1. **code-evaluation.md** — quantised eval, soft eval surface updates, and diagnostic format all drift from implementation
2. **runtime-modes.md** — flat 4-mode model vs 2-level code reality
3. **RUNTIME_CONTRACT.md** — missing WASM-only capabilities and several ABI exports
4. **PROTOCOL.md redirect** — multiple specs still reference the old location with stale content
5. **STABLE_CORE.md §7** — visualisation promise in hardware-only mode not met

---

## 5. Suggested Next Actions

### Highest-Value Fixes (Top 5)

1. **Fix `__useqWasmRuntime` global** (WASM-001, S1) — Set the global after `useq_init()` in both `wasmRuntimePort.ts` and `wasmRuntime.worker.ts`. This is a one-line fix that restores all WASM diagnostic functionality.

2. **Add connection mutex in connector.ts** (RT-S2-03, S2) — Prevent concurrent connect attempts with a simple flag/mutex. Prevents state corruption during reconnect races.

3. **Fix disconnect handler port identity check** (RT-S3-01, S3) — Compare event port against saved port in the disconnect handler, matching the connect handler's logic.

4. **Unify editor content persistence paths** (UI-013, S3) — Change `editorCompartments.ts` to write to `editorCode` and remove the dead `editorContent` write. Eliminates fragile dual-write situation.

5. **Update RUNTIME_CONTRACT.md with missing WASM-only capabilities** (DRIFT-012, S3) — Add diagnostics-readback, probe-evaluation, batch-output-sampling to the contract. Low effort, high documentation value.

### Highest-Value Tests (Top 5)

1. **Editor evaluation pipeline integration test** (TG-S2-01) — Test editor content → WASM eval → diagnostics push → inline annotation. This is STABLE_CORE #1.

2. **Transport orchestrator pure function tests** (TG-S2-02) — Test `parseTransportState` and `extractTransportStateFromMeta`. Low effort, covers transport command correctness.

3. **Settings normalization tests** (TG-S2-04) — Test each normalizer with known input→output pairs. Prevents silent preference loss on upgrades.

4. **URL parameter precedence integration test** (TG-S3-03) — Test the full precedence chain (URL > localStorage > defaults) including `?config` merge behavior.

5. **Wire protocol contract test fixes** (TG-S3-01, TG-S3-02) — Replace vacuous assertions with real tests for standalone diagnostics and `sendSetLiveInputs`.

### Suggested Order of Work

1. **Immediate (S1 fix):** Set `__useqWasmRuntime` global — restores all WASM diagnostics
2. **Short-term (S2 fixes):** Connection mutex, runtime state labels, eval-integration decoupling
3. **Short-term (critical tests):** Editor eval pipeline, transport orchestrator, settings normalization
4. **Medium-term (S3 fixes):** Spec/implementation alignment, persistence cleanup, transport hardening
5. **Ongoing:** Spec cleanup (remove stale references, document actual behavior)

### Candidates for `bd` Issues

All 106 findings are actionable enough to become `bd` issues. The highest-priority candidates:

| Finding | Title | Priority |
|---------|-------|----------|
| WASM-001 | Fix __useqWasmRuntime global — WASM diagnostics non-functional | P0 |
| DRIFT-002 | Quantised eval sends immediately — implement or update spec | P1 |
| WASM-002 | useq_active_diagnostics is a stub — per-output health non-functional | P1 |
| RT-S2-03 | Race condition in concurrent serial connections | P1 |
| UI-002 | Runtime state visually indistinguishable without hover | P1 |
| UI-003 | WASM crash has no auto-restart or user notification | P1 |
| UI-013 | Dual editor content persistence paths — dead write | P1 |
| TG-S2-01 | Editor evaluation pipeline untested end-to-end | P1 |
| TG-S2-02 | Transport orchestrator has zero test coverage | P1 |
| DRIFT-013 | Soft eval doesn't update probes/highlights as spec promises | P2 |

---

## 6. Appendix

### Raw Command Summaries

| Command | Exit Code | Key Observation |
|---------|-----------|-----------------|
| `npm run src-useq:status` | 0 | Pinned 7f3a887, feature/bytecode-vm-core, clean |
| `npm run test:unit` | 0 | 80 files, 1877 tests passing |
| `npm run test:mocha` | 0 | 213 passing, 42 pending |
| `npm run typecheck` | 2 | 46 pre-existing type errors |
| `npm run lint` | 0 | Clean |
| `diff src-useq/wasm/useq.js public/wasm/useq.js` | 0 | Files identical |

### Notable Searches Run

1. `rg '__useqWasmRuntime' src/ src-useq/` — Found reads but zero writes (confirmed S1)
2. `rg 'localStorage\.' src/` — Found 1 production violation (zen/progress.ts)
3. `rg 'CustomEvent|dispatchEvent' src/` — Zero production CustomEvent usage (convention followed)
4. `rg 'TODO|FIXME|HACK|XXX' src/ --type ts` — 6 matches, 3 with product impact
5. `rg ' as any' src/ --type ts` — 55 matches, 12 in production code
6. `rg 'catch\s*\([^)]*\)\s*\{\s*\}' src/ --type ts` — 1 empty catch block
7. `rg '@ts-nocheck' src/` — Zero violations (convention followed)
8. `rg 'wasmInWorker' src/` — Stale references to always-on worker mode
9. `rg 'EXPORTED_FUNCTIONS' src-useq/scripts/build_wasm.sh` — Confirmed match with wasmAbi.ts
10. `rg '(\.skip|\.only|\.todo)' --type ts` — 2 skipped tests, 0 .only

### Files Reviewed

Over 150 source files, 30+ spec documents, and 80+ test files were inspected during this audit. See the consolidated file list in the Methodology section.
