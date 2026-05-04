# Gamepad rebuild — handoff

> **Status as of 2026-05-01.** All three stages of the new gamepad pipeline are complete with **176 passing tests**. Action registry has reversibility metadata (`ReversibleActionId` / `NonReversibleActionId`). Five paradigm files ship. Full pipeline wiring in `index.ts` provides a drop-in `createGamepadPipeline()` replacement for `gamepadIntents.ts`. The actual cutover in `bootstrap.ts` (swapping the import) and browser testing are still ahead.
>
> Read this doc end-to-end before touching gamepad code. Then read [gamepad.md](gamepad.md) (normative spec) and skim [structural-editing.md](structural-editing.md) (the algebra the gamepad invokes through `ActionId`).

### Source files

- `src/lib/gamepad/types.ts` — LogicalEvent, Gesture, AxisFrame, Layer, Resolution, DualBinding, GamepadState, AppStateSnapshot
- `src/lib/gamepad/gestures.ts` — smart constructors + `keyOf` + `chordFromArray`
- `src/lib/gamepad/recognizer.ts` — Stage 2: `step`, `flush`, `recognize`
- `src/lib/gamepad/resolver.ts` — Stage 3: `activeStack`, `resolveGesture`, `resolveAxis`, `lintBindings`
- `src/lib/gamepad/dispatcher.ts` — `createDispatcher`, eager-with-undo, action firing
- `src/lib/gamepad/hardware.ts` — Stage 1: `diffSnapshots` (snapshot diffing to LogicalEvent[])
- `src/lib/gamepad/index.ts` — full pipeline wiring: `createGamepadPipeline()`, re-exports
- `src/lib/gamepad/paradigms/` — `modal-shift.ts`, `leader.ts`, `hydra.ts`, `chord-heavy.ts`, `picker.ts`
- `src/lib/keybindings/actions.ts` — `ActionDef.reversible`, `ReversibleActionId`, `NonReversibleActionId`, `isReversible()`
- `src/lib/gamepad/gamepadManager.ts` — low-level Gamepad API polling (legacy, to be replaced)
- `src/contracts/gamepadChannels.ts` — axis channel registry and typed gamepad channels
- `src/editors/gamepadNavigation.ts` — gamepad-to-editor navigation bridge (eval, manual-control axis only; spatial nav ActionIds dispatch through the keybindings handler registry directly)
- `src/ui/adapters/gamepadMenuBridge.ts` — picker bridge (migrates to action-based dispatch)
- Tests: `src/lib/gamepad/{gestures,recognizer,resolver,dispatcher,hardware}.test.ts`, `src/lib/gamepad/paradigms/paradigms.test.ts`

---

## 1. Where we are

```
docs/specs/gamepad.md               — full spec (~530 lines, source of truth)
src/lib/gamepad/types.ts            — types (LogicalEvent, Gesture, AxisFrame, Layer, Resolution, …)
src/lib/gamepad/gestures.ts         — smart constructors + keyOf + chordFromArray
src/lib/gamepad/recognizer.ts       — Stage 2: step / flush / recognize
src/lib/gamepad/resolver.ts         — Stage 3: activeStack / resolveGesture / resolveAxis / lintBindings
src/lib/gamepad/dispatcher.ts       — Dispatcher: eager-with-undo, action firing, layer push/pop
src/lib/gamepad/gestures.test.ts    — 32 tests
src/lib/gamepad/recognizer.test.ts  — 80 tests (per-primitive + step/flush contract)
src/lib/gamepad/resolver.test.ts    — 26 tests (layer stack, resolution, miss handling, axis, lint)
src/lib/gamepad/dispatcher.test.ts  — 12 tests (action dispatch, eager-with-undo, leaders, miss)
src/lib/keybindings/actions.ts      — ActionDef now has `reversible: boolean`; derives ReversibleActionId / NonReversibleActionId
```

Total: **150/150** passing. Run with `npx vitest run --project unit src/lib/gamepad/`.

What remains:
- The cutover from `src/lib/gamepadIntents.ts` — swap `createGamepadIntentEmitter()` for `createGamepadPipeline({ editor })` in `bootstrap.ts` and test in-browser
- Wire `menuOpen` state into `getAppState()` in `index.ts` (currently hardcoded `false`)
- Property tests via `fast-check` (§3.8 below)

---

## 2. Architectural commitments — do **not** relitigate without strong reason

These were chosen deliberately during the brainstorm. Every one has a "why" that's load-bearing.

1. **Three-stage pipeline with pure-function seams.**
   `Hardware ▶ LogicalEvent[] ▶ Gesture[] + AxisFrame[] ▶ ActionId | Effect`
   Each stage is independently testable. Don't merge stages, don't skip the `LogicalEvent` layer "for performance".

2. **The recognizer is binding-blind.** It always emits every gesture the timeline structurally implies — a tap *and* a hold *and* a doubleTap on the same press if all qualify. The dispatcher reasons about which to honour.
   *Why:* keeps Stage 2 closed, small, and testable. Lets the dispatcher own all binding-aware concerns (eager-with-undo, deferral).

3. **Eager-with-undo for dual-bound buttons.** When `tap` and `hold` are both bound on the same button, tap fires eagerly on press; if hold's threshold elapses with the button still held, the dispatcher calls `editor.undo()` once, then dispatches the hold action. Same pattern for `tap + doubleTap`.
   *Why:* zero latency on the common case (tap-only feel) without sacrificing dual-bind expressiveness.

4. **Reversibility enforced at the type level.** `ActionId = ReversibleActionId | NonReversibleActionId`. Bindings types only allow `tap + hold` co-binding when `tap` is `ReversibleActionId`. Compile error otherwise.
   *Why:* the eager-with-undo model demands tap actions be reversible; this lifts the constraint into the type system instead of runtime lint.

5. **Layered bindings; declarative `when:` predicates.** Stack of layers, top-down resolution; first match wins. Layers are activated by `when: (state) => boolean` evaluating against `gamepadStateStore` + other stores. Transient layers (leaders, hydras) also live in `gamepadStateStore.transientLayers` so the same declarative mechanism applies.
   *Why:* state-driven, fully data-testable; no scattered imperative `pushLayer` calls; one mental model.

6. **Picker integration via the action namespace, not bespoke channels.** Picker layer binds gestures to `picker.*` ActionIds. Picker components subscribe to the action dispatcher.
   *Why:* keyboard and gamepad share the entire action surface. No second-class subsystems. (Migration aid: a `{kind:'channel', ch, payload}` escape hatch is allowed during the transition — see §10.2 of spec.)

7. **`step` / `flush` are the primitive recognizer API.** `recognize(events, options)` is a thin batch wrapper that folds `step` and then `flush`es. Production calls `step` per event from the polling loop, holding `RecognizerState` between ticks.
   *Why:* avoids re-recognizing the whole timeline every poll. State is small, immutable, transferrable, snapshot-friendly.

8. **Hardware-free unit testing.** Stage 1 is the **only** component allowed to call `navigator.getGamepads()`, `performance.now()`, `setTimeout`, etc. Every other test runs in Node with synthetic `LogicalEvent[]` and explicit timestamps.

---

## 3. What to do next, in priority order

### ~~3.1 — Stage 3 brainstorm~~ ✓ DONE
### ~~3.2 — Action registry reversibility refactor~~ ✓ DONE
### ~~3.3 — Stage 3 resolver~~ ✓ DONE
### ~~3.4 — Dispatcher~~ ✓ DONE
### ~~3.5 — Paradigm files~~ ✓ DONE
### ~~3.6 — Stage 1 hardware adapter~~ ✓ DONE
### ~~3.9 — Cleanup~~ ✓ DONE

### 3.7 — Cutover from `gamepadIntents.ts`

The old code is still wired into the running app. The new `createGamepadPipeline()` in `src/lib/gamepad/index.ts` is a drop-in replacement. To swap:
1. In `bootstrap.ts`: replace `createGamepadIntentEmitter()` → `createGamepadPipeline({ editor })` (import from `./lib/gamepad`).
2. The `bindGamepadNavigation` and `bindGamepadMenuBridge` calls can stay — the new pipeline publishes to the same channels during migration.
3. Wire `menuOpen` state from the menu store into `getAppState()` in `index.ts`.
4. Browser-test all paradigm interactions: navigation, picker mode, structural editing, leader sequences.
5. Once validated, remove `gamepadIntents.ts` and the legacy combo registry in `keybindings/defaults.ts`.

### 3.8 — Property tests via `fast-check`

Spec §8.3. Determinism is asserted in example tests today; property tests would catch composition / split-and-rejoin bugs and unusual orderings. `bun add -d fast-check` to add. Don't bother until the recognizer and resolver are stable — would slow iteration.

---

## 4. Traps and gotchas

- **`held` and `hold` are mutually exclusive per button** — but it's a *bindings-load lint* (see `lintBindings()` in `resolver.ts`), not a recognizer concern. The recognizer happily emits both for the same press; the dispatcher chooses based on what's bound.
- **Boundary semantics differ between primitives.** Hold and held use **strict `<`** for "past threshold" (release at exactly T_hold does not emit hold). Chord and doubleTap use **inclusive `<=`** for "within grace" (presses at exactly the boundary do count). These are different concepts; don't unify them.
- **`evaluateUpTo` defaults to the last-event timestamp.** That's the right batch-mode default ("don't speculate past what we've seen") but it means a press-without-release with no `evaluateUpTo` emits no hold/held. In production, pass `performance.now()`. In tests, pass an explicit value when testing ongoing presses.
- **`pendingHelds` doubles as the "currently held buttons" set.** Every press adds one entry; release removes one entry; the entry carries `pressedAt` for chord lookback. Don't add a parallel `heldButtons` field — it'd duplicate state and risk drift.
- **`AxisName` and per-axis 1D events were removed.** Stage 1 now emits 2D axis events with `stick: StickName`. Don't reintroduce per-axis events at this layer; if the hardware adapter wants to track per-axis state internally, that's fine, but the boundary to Stage 2 is per-stick.
- **`y > 0` is "down"** in the flick direction logic (`directionOf` in `recognizer.ts`). This matches screen-coordinate convention. Verify Stage 1's hardware adapter passes raw stick values such that pulling the stick down gives positive y. The Web Gamepad API typically does this; double-check on test hardware.
- **Chord canonicalisation uses BUTTON_ORDER** (declaration order in `types.ts`), not alphabetical. `chord(['Y', 'A', 'LB']).btns` is `['A', 'Y', 'LB']`, not `['A', 'LB', 'Y']`. The spec example in §4.4.1 is consistent with this; don't "fix" it to alphabetical without reading the test goldens.
- **`previousPresses` is set on release, not on press.** This was deliberate — at release time, the matching `pendingHelds` entry still has the press's `pressedAt`, so we capture it then. Don't try to capture press time at press time without first checking that you're not double-counting.
- **The `recognize` test file is one big file.** It's organised by `describe` blocks per primitive, plus a `step / flush` contract block at the end. ~800 lines. Don't split prematurely; the cross-primitive interactions are easier to read in one place.
- **Layer priority follows array declaration order.** In `activeStack`, predicate-driven layers are returned in the order they appear in the `layers` array. Higher-priority layers (e.g. picker) should be declared *first* in the array so they shadow lower layers during resolution.
- **Transient layers prepend to the stack.** They always sit above all predicate-driven layers. A transient layer's `onMiss` policy determines what happens when a gesture isn't bound in that layer.

---

## 5. Pointers to important files

**Spec and adjacent specs:**
- `docs/specs/gamepad.md` — the gamepad spec; normative
- `docs/specs/structural-editing.md` — algebra of editor operations the gamepad ultimately invokes
- `docs/specs/keybindings.md` — shared `ActionId` namespace
- `docs/specs/MAIN.md` — index of all specs

**New code:**
- `src/lib/gamepad/types.ts` — types (including Layer, Resolution, DualBinding, GamepadState, AppStateSnapshot)
- `src/lib/gamepad/gestures.ts` — smart constructors + `keyOf` + `chordFromArray`
- `src/lib/gamepad/recognizer.ts` — Stage 2: `step`, `flush`, `recognize`, `INITIAL_STATE`, `Timing`, `RecognizerState`, `StepOutput`
- `src/lib/gamepad/resolver.ts` — Stage 3: `activeStack`, `resolveGesture`, `resolveAxis`, `lintBindings`, `buildLayerMap`
- `src/lib/gamepad/dispatcher.ts` — `createDispatcher`, `DispatcherConfig`, `Dispatcher`
- `src/lib/gamepad/hardware.ts` — Stage 1: `diffSnapshots` (snapshot diffing to LogicalEvent[])
- `src/lib/gamepad/index.ts` — full pipeline wiring: `createGamepadPipeline()`, re-exports
- `src/lib/gamepad/paradigms/picker.ts` — picker layer (always-present, activates when menu open)
- `src/lib/gamepad/paradigms/modal-shift.ts` — modal-shift paradigm (LB/RB as modifiers)
- `src/lib/gamepad/paradigms/leader.ts` — leader (vim-style) paradigm
- `src/lib/gamepad/paradigms/hydra.ts` — hydra (Emacs-style) paradigm
- `src/lib/gamepad/paradigms/chord-heavy.ts` — chord-heavy paradigm
- `src/lib/keybindings/actions.ts` — `ActionDef.reversible`, `ReversibleActionId`, `NonReversibleActionId`, `isReversible()`
- `src/lib/gamepad/{gestures,recognizer,resolver,dispatcher,hardware}.test.ts` — golden + contract tests
- `src/lib/gamepad/paradigms/paradigms.test.ts` — paradigm smoke tests through the resolver

**Existing code that will be touched:**
- `src/lib/gamepadIntents.ts` — legacy; will be replaced by Stages 1/3 + dispatcher
- `src/contracts/gamepadChannels.ts` — legacy; the axis-channel registry from spec §4.6 will live somewhere similar
- `src/ui/adapters/gamepadMenuBridge.ts` — picker bridge; migrates to action-based dispatch
- `src/lib/gamepadManager.ts` — low-level polling; Stage 1 builds on / replaces this

**Test infrastructure:**
- `vite.config.ts` — `unit` project includes `src/**/*.test.ts`
- Run gamepad-only: `npx vitest run --project unit src/lib/gamepad/`
- Run a single test by name: `npx vitest run --project unit src/lib/gamepad/recognizer.test.ts -t "release before T_hold"`
