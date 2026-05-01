# Gamepad rebuild — handoff

> **Status as of 2026-05-01.** Stage 2 (recognizer) of the new gamepad pipeline is complete with 112 passing tests. Architecture validated through all six gesture primitives. Stages 1, 3, dispatcher, paradigms, and the cutover from the legacy `gamepadIntents.ts` are still ahead.
>
> Read this doc end-to-end before touching gamepad code. Then read [gamepad.md](gamepad.md) (normative spec) and skim [structural-editing.md](structural-editing.md) (the algebra the gamepad invokes through `ActionId`).

---

## 1. Where we are

```
docs/specs/gamepad.md             — full spec (~530 lines, source of truth)
src/lib/gamepad/types.ts          — types only (LogicalEvent, Gesture, AxisFrame, …)
src/lib/gamepad/gestures.ts       — smart constructors + keyOf + chordFromArray
src/lib/gamepad/recognizer.ts     — Stage 2: step / flush / recognize
src/lib/gamepad/gestures.test.ts   — 32 tests
src/lib/gamepad/recognizer.test.ts — 80 tests (per-primitive + step/flush contract)
```

Total: **112/112** passing. Run with `npx vitest run --project unit src/lib/gamepad/`.

The spec was rebuilt in this session via a long brainstorm; the recognizer was implemented via golden TDD, primitive by primitive (tap → hold → held → chord → flick + AxisFrame → doubleTap), with one architectural refactor partway (extracting `step` / `flush` from the closure-mutation `recognize`).

What does **not** exist yet:
- Stage 1 (hardware adapter that produces `LogicalEvent[]` from polling)
- Stage 3 (layer-stack resolver; bindings; pop / miss policies)
- Dispatcher (eager-with-undo; action firing; transient layer state mutation)
- Action registry reversibility metadata (`ReversibleActionId | NonReversibleActionId`)
- Paradigm binding files
- The cutover from `src/lib/gamepadIntents.ts` (still wired into the running app)

---

## 2. Architectural commitments — do **not** relitigate without strong reason

These were chosen deliberately during the brainstorm. Every one has a "why" that's load-bearing.

1. **Three-stage pipeline with pure-function seams.**
   `Hardware ▶ LogicalEvent[] ▶ Gesture[] + AxisFrame[] ▶ ActionId | Effect`
   Each stage is independently testable. Don't merge stages, don't skip the `LogicalEvent` layer "for performance".

2. **The recognizer is binding-blind.** It always emits every gesture the timeline structurally implies — a tap *and* a hold *and* a doubleTap on the same press if all qualify. The dispatcher reasons about which to honour.
   *Why:* keeps Stage 2 closed, small, and testable. Lets the dispatcher own all binding-aware concerns (eager-with-undo, deferral). Spec §5.2.3 says "the recognizer MUST defer tap commitment" — that's a **wording leak**; it should say "the dispatcher". Don't take it literally.

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

### 3.1 — Stage 3 brainstorm (recommended before coding)

The layer-stack mechanics in §4 of the spec are non-trivial: declarative `when:` predicates, transient layers stored in `gamepadStateStore`, `popOn` policies (resolution / miss-or-cancel / timeout / predicate), `onMiss` policies (fall-through / pop-and-fall-through / pop-and-discard / noop-flash). Pretty much all of §4.7's defaults are TBD on first contact with reality.

Suggest a fresh session that opens with: read `docs/specs/gamepad.md` §4 and §6, then drive an interview-style brainstorm to nail down the `Resolution` type shape, the layer-stack composition function, and what the test harness for the resolver looks like before writing any code.

### 3.2 — Action registry reversibility refactor (small, isolated)

`src/lib/keybindings/actions.ts` currently has `ActionDef` with `repeatable?: boolean` but no reversibility flag. Need to:
1. Add a `reversible: boolean` field (or split into branded subtypes).
2. Tag every existing action — most editor / structural ops are reversible; transport, eval, picker are not.
3. Derive the `ReversibleActionId | NonReversibleActionId` literal-union types from the registry.
4. Wire the bindings-load lint to enforce the dual-binding constraint.

This unblocks Stage 3's binding type definitions. Could be done in parallel with the Stage 3 brainstorm.

### 3.3 — Stage 3 resolver

Pure function `resolve(gesture, state, layers) → Resolution | null`. Plus the layer-stack composer that filters by `when:` predicates and prepends transient layers. The catch-up + emit pattern from the recognizer is a model for how to think about the resolver as a state machine if needed (most likely it's stateless).

### 3.4 — Dispatcher

The single impure component. Receives `Resolution` records, runs actions, handles eager-with-undo timing, mutates `gamepadStateStore`. Needs a reasonable interface to the existing action runner.

### 3.5 — Paradigm files

`src/lib/gamepad/paradigms/{modal-shift,leader,hydra,chord-heavy,picker}.ts`. Each exports a `Layer[]`. Pure data; should be testable with synthetic `AppState` + the resolver alone.

### 3.6 — Stage 1 hardware adapter

Replaces the polling loop in `src/lib/gamepadIntents.ts`. Reads from `navigator.getGamepads()`, applies deadzones, emits `LogicalEvent[]` to drive `step`. Keep this thin — every nontrivial decision belongs upstream.

### 3.7 — Cutover from `gamepadIntents.ts`

The old code is still wired into the running app. Coordinate the swap once Stages 1 + 3 + dispatcher are working end-to-end. Old channels (`pickerNavigate`, `pickerSelect`, `evalNow`, etc.) get migrated to `picker.*` and `eval.*` ActionIds via the new dispatcher. The escape-hatch in §10.2 of the spec is the migration aid.

### 3.8 — Property tests via `fast-check`

Spec §8.3. Determinism is asserted in example tests today; property tests would catch composition / split-and-rejoin bugs and unusual orderings. `bun add -d fast-check` to add. Don't bother until the recognizer and resolver are stable — would slow iteration.

### 3.9 — Cleanup

- Drop `(Cycle N)` labels from the test `describe` blocks. They were useful for TDD attribution; they're noise now.
- Patch spec §5.2.3 — replace "the recognizer MUST defer tap commitment" with "the dispatcher MUST defer".
- Patch spec §8.2 example — `tap('A', { committedAt: 120 })` predates the decision to put `t` on `GestureEvent` instead of `Gesture`. The actual API is `at(tap('A'), 120)`.

---

## 4. Traps and gotchas

- **`held` and `hold` are mutually exclusive per button** — but it's a *bindings-load lint*, not a recognizer concern. The recognizer happily emits both for the same press; the dispatcher chooses based on what's bound.
- **Boundary semantics differ between primitives.** Hold and held use **strict `<`** for "past threshold" (release at exactly T_hold does not emit hold). Chord and doubleTap use **inclusive `<=`** for "within grace" (presses at exactly the boundary do count). These are different concepts; don't unify them.
- **`evaluateUpTo` defaults to the last-event timestamp.** That's the right batch-mode default ("don't speculate past what we've seen") but it means a press-without-release with no `evaluateUpTo` emits no hold/held. In production, pass `performance.now()`. In tests, pass an explicit value when testing ongoing presses.
- **`pendingHelds` doubles as the "currently held buttons" set.** Every press adds one entry; release removes one entry; the entry carries `pressedAt` for chord lookback. Don't add a parallel `heldButtons` field — it'd duplicate state and risk drift.
- **`AxisName` and per-axis 1D events were removed in Cycle 6.** Stage 1 now emits 2D axis events with `stick: StickName`. Don't reintroduce per-axis events at this layer; if the hardware adapter wants to track per-axis state internally, that's fine, but the boundary to Stage 2 is per-stick.
- **`y > 0` is "down"** in the flick direction logic (`directionOf` in `recognizer.ts`). This matches screen-coordinate convention. Verify Stage 1's hardware adapter passes raw stick values such that pulling the stick down gives positive y. The Web Gamepad API typically does this; double-check on test hardware.
- **Chord canonicalisation uses BUTTON_ORDER** (declaration order in `types.ts`), not alphabetical. `chord(['Y', 'A', 'LB']).btns` is `['A', 'Y', 'LB']`, not `['A', 'LB', 'Y']`. The spec example in §4.4.1 is consistent with this; don't "fix" it to alphabetical without reading the test goldens.
- **`previousPresses` is set on release, not on press.** This was deliberate — at release time, the matching `pendingHelds` entry still has the press's `pressedAt`, so we capture it then. Don't try to capture press time at press time without first checking that you're not double-counting.
- **The `recognize` test file is one big file.** It's organised by `describe` blocks per primitive, plus a `step / flush` contract block at the end. ~800 lines. Don't split prematurely; the cross-primitive interactions are easier to read in one place.

---

## 5. Pointers to important files

**Spec and adjacent specs:**
- `docs/specs/gamepad.md` — the gamepad spec; normative
- `docs/specs/structural-editing.md` — algebra of editor operations the gamepad ultimately invokes
- `docs/specs/keybindings.md` — shared `ActionId` namespace
- `docs/specs/MAIN.md` — index of all specs

**New code (this session):**
- `src/lib/gamepad/types.ts` — types only
- `src/lib/gamepad/gestures.ts` — smart constructors + `keyOf` + `chordFromArray`
- `src/lib/gamepad/recognizer.ts` — Stage 2: `step`, `flush`, `recognize`, `INITIAL_STATE`, `Timing`, `RecognizerState`, `StepOutput`
- `src/lib/gamepad/{gestures,recognizer}.test.ts` — golden + contract tests

**Existing code that will be touched:**
- `src/lib/keybindings/actions.ts` — needs reversibility metadata refactor
- `src/lib/gamepadIntents.ts` — legacy; will be replaced by Stages 1/3 + dispatcher
- `src/contracts/gamepadChannels.ts` — legacy; the axis-channel registry from spec §4.6 will live somewhere similar
- `src/ui/adapters/gamepadMenuBridge.ts` — picker bridge; migrates to action-based dispatch
- `src/lib/gamepadManager.ts` — low-level polling; Stage 1 builds on / replaces this

**Test infrastructure:**
- `vite.config.ts` — `unit` project includes `src/**/*.test.ts`
- Run gamepad-only: `npx vitest run --project unit src/lib/gamepad/`
- Run a single test by name: `npx vitest run --project unit src/lib/gamepad/recognizer.test.ts -t "release before T_hold"`

---

## 6. Commit log to skim

Useful for understanding the design trajectory:

```
55d90ea  docs(gamepad): rework spec — three-stage pipeline, layered bindings, paradigms
e4259c6  feat(gamepad): types + smart constructors (cycle 1)
1ed182d  feat(gamepad): tap recognizer (cycle 2)
fef78dd  feat(gamepad): hold recognizer (cycle 3)
829af1f  refactor(gamepad): step/flush as primitive API; recognize as batch wrapper
13ab037  feat(gamepad): held auto-repeat recognizer (cycle 4)
4ec9457  feat(gamepad): chord recognizer (cycle 5)
fd98c95  feat(gamepad): flick + AxisFrame recognizer (cycle 6)
f59bf08  feat(gamepad): doubleTap recognizer (cycle 7)
```

Each commit message describes the design choice for that cycle. Read the refactor commit (`829af1f`) carefully — that's where the `step` / `flush` shape was introduced, and the rationale matters for anyone considering changes to the API.
