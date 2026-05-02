# Gamepad input

> Spec: ontology and algebra of gamepad input. Defines the **primitives** out of which every gamepad-driven interaction is built, and the **paradigms** (binding setups) the system supports for experimentation.
> See also [structural-editing.md](structural-editing.md) (the algebra of operations the gamepad ultimately invokes), [keybindings.md](keybindings.md) (the shared `ActionId` namespace), [editor.md](editor.md), [overlays.md](overlays.md).
>
> This spec defines what gamepad input *means*. Concrete button-to-action assignments live in **bindings** (§4) and ship as **paradigms** (§6) the user can swap, edit, or replace.

---

## 1. Frame

1.1 The gamepad is a **first-class peer of the keyboard**. Both reach the same `ActionId` namespace. A gesture bound to `edit.slurpForward` and a keyboard chord bound to the same action produce identical state transitions.

1.2 Gamepad input flows through a **three-stage pipeline** with a clean test seam between every stage. Each stage is a pure function over its inputs; stateful concerns (timers, repeat counters, transient layer stacks) are explicit data passed in and out.

```
   Hardware ▶ LogicalEvent[] ▶ Gesture[] + AxisFrame[] ▶ ActionId | Effect
              (seam #1)        (seam #2)                 (seam #3)
   §3.1            §3.2                §3.3                  §4
```

1.3 The system is **driven by data**. Every binding is a typed record; every state predicate is a pure function over a snapshot. A unit test that builds a synthetic `LogicalEvent[]` timeline, a synthetic `AppState` snapshot, and a binding table can exercise the entire pipeline without touching any DOM, `navigator.getGamepads()`, or `setTimeout`. Hardware-free testing is a first-class requirement, not a side-effect.

1.4 Type safety is the priority. Every gesture, every binding entry, every action ID is statically typed. Impossible bindings (e.g. binding a non-reversible action as a `tap` when there is also a `hold` on the same button — see §5) are rejected at compile time. String keys exist only as derived canonical lookup keys (§4.4); the source of truth is always the discriminated union.

1.5 Gamepad disconnect MUST NOT crash the app. The poller silently no-ops while no gamepad is connected; reconnect is detected automatically (existing `gamepadManager.ts` behaviour, preserved).

1.6 Polling cadence: ~50 ms for snapshot reads from the Gamepad API. Gestures and axis frames are emitted at this cadence; downstream consumers MAY throttle their own work.

---

## 2. Roles of the three stages

2.1 **Stage 1 — Logical input.** Reads `Gamepad` API state at the polling cadence; emits a normalised, monotonically-timestamped `LogicalEvent[]` stream. Applies deadzone and button-press thresholds. No knowledge of bindings, layers, or app state.

2.2 **Stage 2 — Recognition.** Consumes `LogicalEvent[]` and emits two parallel streams: a discrete `Gesture[]` (taps, holds, helds, double-taps, chords, flicks) and a continuous `AxisFrame[]` (live stick positions). Recognition is a pure state machine: `(RecognizerState, LogicalEvent) → (RecognizerState, Gesture[], AxisFrame[])`. The state contains only timer cursors and pressed-button bookkeeping; no app state.

2.3 **Stage 3 — Resolution.** Maps each `Gesture` (or `AxisFrame`) against the **layer stack** to produce an `ActionId` (or an axis-channel publication, or a transient-layer push). Layers are evaluated top-down; the first matching layer wins. Resolution is a pure function over `(Gesture, AppState, Layer[]) → Resolution`.

2.4 The **dispatcher** (separate from resolution) actually fires actions, manages the eager-with-undo timing for dual-bound buttons, and mutates the gamepad state store. It is the only impure component.

---

## 3. Ontology

### 3.1 LogicalEvent

```ts
type ButtonName =
  | 'A'  | 'B'  | 'X'  | 'Y'
  | 'LB' | 'RB' | 'LT' | 'RT'
  | 'Up' | 'Down' | 'Left' | 'Right'
  | 'Start' | 'Back'
  | 'LeftStickPress' | 'RightStickPress'

type StickName = 'LeftStick' | 'RightStick'

type LogicalEvent =
  | { kind: 'press';   btn: ButtonName; t: number }
  | { kind: 'release'; btn: ButtonName; t: number }
  | { kind: 'axis';    stick: StickName; x: number; y: number; t: number }
```

Stage 1 combines the two raw axes of each stick into a single 2D `axis` event. The recognizer never sees per-axis 1D values — `(x, y)` are the full stick state at the polled moment.

3.1.1 `t` is a monotonic millisecond timestamp from a single clock source. In tests this is a synthetic counter; in production it is `performance.now()`.

3.1.2 Stage 1 MUST emit a `release` for every prior `press` of the same button. If polling misses a press/release pair entirely (sub-poll-interval tap), Stage 1 MAY synthesize the release at the same timestamp as the press. Stage 2 MUST tolerate degenerate `press → release` pairs at identical `t`.

3.1.3 Axis events fire at every poll where either the deadzone-filtered `x` or `y` value differs from the previous poll. A return to centre emits an axis event with `(0, 0)`.

### 3.2 Gesture

```ts
type Direction = 'up' | 'down' | 'left' | 'right'

type Gesture =
  | { kind: 'tap';       btn: ButtonName }
  | { kind: 'hold';      btn: ButtonName }                       // one-shot @ T_hold
  | { kind: 'held';      btn: ButtonName; n: number }            // auto-repeat tick #N
  | { kind: 'doubleTap'; btn: ButtonName }
  | { kind: 'chord';     btns: readonly [ButtonName, ButtonName, ...ButtonName[]] }
  | { kind: 'flick';     stick: StickName; dir: Direction }
```

3.2.1 **Tap** — fired on press OR release depending on the dual-binding context (see §5). A tap is a one-shot, momentary acknowledgement that the user pressed the button.

3.2.2 **Hold** — a one-shot fired exactly once at the moment a press has been held continuously past `T_hold` (default 250 ms). Distinct from `held`: this is the deliberate "long-press" gesture used in eager-with-undo dual bindings.

3.2.3 **Held** — auto-repeat ticks while a button stays pressed past the initial repeat delay (default 300 ms), at the repeat interval (default 60 ms). `n` counts from 1 (the first repeat after the initial delay). Used for held-direction navigation and similar continuous operations. **Hold and held are mutually exclusive per button** — a button MUST NOT be bound to both. Lint at bindings load.

3.2.4 **DoubleTap** — two complete press-release cycles on the same button within `T_doubleTap` (default 300 ms). When `tap` is also bound on the same button, the recognizer MUST defer tap commitment until the double-tap window closes (see §5.2).

3.2.5 **Chord** — two or more buttons pressed simultaneously. `btns` is a tuple of length ≥ 2 with **distinct** entries; the type system enforces ≥ 2 via the tuple form, distinctness via a runtime invariant in the smart constructor (`chord(['LB','A'])`). Order in the tuple is canonicalised (sort by `ButtonName` enum) so `chord(['LB','A'])` and `chord(['A','LB'])` produce the same `Gesture`.

3.2.6 **Flick** — a stick crosses the flick threshold (default 0.7 magnitude) in a cardinal direction. The recognizer re-arms only after the stick returns inside the deadzone. One discrete `Flick(dir)` per arming. Distinct from `axis` (continuous).

3.2.7 The recognizer MAY emit multiple gestures per `LogicalEvent` (e.g. a delayed `tap` on a release after a previous press timed out). Output gesture order MUST be deterministic given the input timeline.

3.2.8 Sequences / leaders are **not** a gesture variant. They are implemented as transient layer activations (§4.5). This keeps the gesture vocabulary closed and small.

### 3.3 AxisFrame

```ts
type AxisFrame = {
  stick: StickName
  x:     number   // -1..1, deadzone applied
  y:     number   // -1..1, deadzone applied
  t:     number
}
```

3.3.1 An `AxisFrame` is emitted at every poll where the deadzoned `(x, y)` for a stick has changed from the previous frame, or when the stick is bound to a fresh axis channel (§4.6).

3.3.2 Stick magnitudes inside the deadzone (default 0.12) are reported as exact `(0, 0)`; jitter inside the deadzone MUST NOT produce frames.

3.3.3 `flick` and `AxisFrame` are independent outputs from the same stick: a stick crossing the flick threshold emits a `Flick` gesture *and* continues emitting `AxisFrame`s. Bindings on either side compose.

---

## 4. Bindings and layers

### 4.1 The layer stack

4.1.1 At every moment the system has an ordered **layer stack**. To resolve a gesture, the system walks the stack from top to bottom; the first layer that binds the gesture wins. If no layer binds it, the gesture is silently dropped (or, for transient layers, the layer's `onMiss` policy fires — §4.7).

4.1.2 The stack is recomputed on every gesture and on every change to the underlying state stores. Stack composition is a pure function:

```ts
function activeStack(state: AppState, layers: Layer[]): Layer[] {
  return [
    ...state.gamepad.transientLayers
        .map(t => layersByName.get(t.name))
        .filter(notNull),
    ...layers.filter(l => !l.when || l.when(state)),
  ]
}
```

Transient layers always sit above predicate-driven layers; within each group the order is the declaration order.

### 4.2 Layer

```ts
type LayerName = string  // branded; nominal type via declarations

type Layer = {
  readonly name:     LayerName
  readonly when?:    (state: AppState) => boolean   // declarative activation
  readonly gestures?: GestureBindings
  readonly axes?:     AxisBindings
  readonly leaders?:  LeaderBindings
  readonly popOn?:    readonly PopPolicy[]          // for transient layers
  readonly onMiss?:   MissPolicy
  readonly ttlMs?:    number                        // for popOn:'timeout'
}
```

4.2.1 A layer with `when:` and no `popOn:` is a **predicate-driven** (permanent / contextual) layer. Active iff `when(state)` is true. Examples: `picker` (when a menu is open), `structural` (when editor mode is structural), `global` (always).

4.2.2 A layer with `popOn:` is a **transient layer**. It is pushed onto the transient stack imperatively by a leader binding (§4.5), and popped according to its policy. Transient layers MAY also have `when:`; the predicate is an additional liveness condition that, when false, pops the layer (§4.5.4).

4.2.3 Layer names are unique. Pushing a transient layer whose name is already on the stack is a no-op (the existing instance keeps its TTL).

### 4.3 Gesture bindings

```ts
type GestureKey = string  // branded; produced by keyOf(gesture)

type GestureBindings = Readonly<Record<GestureKey, ActionId | DualBinding>>

type DualBinding = {
  readonly tap?:  ReversibleActionId      // requires reversibility (§5)
  readonly hold?: ActionId
  readonly held?: ActionId                 // mutually exclusive with hold
}
```

4.3.1 Bindings are authored using smart constructors that produce typed `Gesture` values; their canonical `GestureKey` is computed for table lookup.

```ts
const structuralLayer: Layer = {
  name: 'structural',
  when: state => state.editor.mode === 'structural',
  gestures: {
    [keyOf(tap('Up'))]:               'nav.out',
    [keyOf(held('Up'))]:              'nav.out',
    [keyOf(tap('A'))]:                { tap: 'mode.insert', hold: 'edit.raise' },
    [keyOf(chord(['LB', 'A']))]:      'menu.openBefore',
    [keyOf(flick('LeftStick','up'))]: 'nav.out',
  },
  axes: { right: 'manual-control' },
  leaders: { [keyOf(tap('Y'))]: 'after-Y' },
}
```

4.3.2 The value of a binding is either an `ActionId` (single-action binding, fires on whichever recognition rule matched) or a `DualBinding` record (separate actions for `tap` / `hold` / `held` on the same button — see §5). When the recognizer emits e.g. `hold('A')` and the matched binding is a `DualBinding`, the system uses `binding.hold`. When the binding is a plain `ActionId`, the system fires that action regardless of which recognition variant produced the gesture.

4.3.3 The `keyOf` function and `tap` / `hold` / etc. constructors live in `src/lib/gamepad/gestures.ts`. They produce typed `Gesture` values whose canonical key form is stable across runs.

### 4.4 GestureKey canonicalisation

4.4.1 `keyOf` produces a deterministic string from any `Gesture`:

```
keyOf(tap('A'))                 → 'tap:A'
keyOf(hold('A'))                → 'hold:A'
keyOf(held('A'))                → 'held:A'
keyOf(doubleTap('A'))           → 'doubleTap:A'
keyOf(chord(['A','LB']))        → 'chord:A+LB'           // sorted
keyOf(flick('LeftStick','up'))  → 'flick:LeftStick:up'
```

4.4.2 The string form is an **internal** canonical key for table lookup. Authors do not type these strings; they call constructors. Tooling that needs to display bindings (settings UI, help) consumes the underlying typed `Gesture` and renders it however it wants.

### 4.5 Leaders and transient layers

4.5.1 A `leaders:` entry maps a gesture to a transient layer name. When the gesture fires and the leader is the topmost-binding match, the system pushes the named layer onto the transient stack with the layer's `ttlMs` and `popOn` policy.

```ts
// in `structural`:
leaders: {
  [keyOf(tap('Y'))]: 'after-Y',
}

// the transient layer itself:
const afterY: Layer = {
  name:    'after-Y',
  popOn:   ['resolution', 'timeout'],
  ttlMs:   800,
  onMiss:  'pop-and-fall-through',
  gestures: {
    [keyOf(tap('A'))]: 'edit.enclose.list',
    [keyOf(tap('X'))]: 'edit.splice',
    [keyOf(tap('B'))]: 'system.cancelLeader',
  },
}
```

4.5.2 Pushing a leader is **not** an `ActionId`. The action namespace is reserved for user-visible operations. Layer push/pop is a separate effect type emitted by the resolver.

4.5.3 Leader bindings sit alongside gesture bindings in the same layer. A gesture matched as a leader does **not** fire a regular action even if also present in `gestures:` for that layer — leaders take precedence within their layer. Across layers, the standard top-down resolution applies.

4.5.4 Transient layer **liveness**. A transient layer with `when:` is dropped from the stack whenever its predicate goes false (independent of `popOn`). This is how predicate-driven hold-shifts (e.g. "while LB held") integrate with the transient stack: the layer is technically permanent (in `layers[]`) but its activation is the predicate; transient mechanics only apply if `popOn` is set.

### 4.6 Axis bindings

4.6.1 Each layer's `axes:` section maps a stick to a named **axis channel**:

```ts
type AxisChannelName =
  | 'manual-control'
  | 'picker.angle'
  | 'scrub'
  | 'param-bind'
  // extensible by registering at module init

type AxisBindings = Readonly<Partial<Record<'left' | 'right', AxisChannelName>>>
```

4.6.2 At every poll, for each stick, the system looks up the topmost active layer that binds that stick and publishes the `AxisFrame` to that channel. Layers below are not consulted for the same stick. If no active layer binds the stick, the frame is dropped.

4.6.3 Axis channels are typed `TypedChannel<AxisFrame>` instances registered in `src/contracts/gamepadChannels.ts`. Subsystems (manual-control, radial picker, scrub) subscribe by channel name. Adding a new channel requires extending the `AxisChannelName` literal union and registering a channel instance — both centralised, both type-checked.

4.6.4 Axis bindings have **no** `tap`/`hold` / eager-with-undo concerns. They are continuous and fire-and-forget.

### 4.7 Pop policies and miss handling

4.7.1 `PopPolicy` is the discriminator on **why** a transient layer ends. Multiple policies can apply to one layer; any one of them firing pops the layer.

```ts
type PopPolicy =
  | 'resolution'      // pop after the first gesture that resolves to an action in this layer
  | 'miss-or-cancel'  // pop only when an unbound gesture arrives or the cancel gesture fires
  | 'timeout'         // pop after `ttlMs` of idle (no input received)
  | 'predicate'       // pop when `when:` goes false (implicit; need not be listed)
```

4.7.2 `MissPolicy` is what happens when a gesture arrives in the topmost layer but isn't bound there:

```ts
type MissPolicy =
  | 'fall-through'           // try the next layer; this layer survives
  | 'pop-and-fall-through'   // pop this layer, then try the next layer with the same gesture
  | 'pop-and-discard'        // pop this layer, ignore the gesture
  | 'noop-flash'             // pop this layer, emit a no-op flash via the action dispatcher
```

4.7.3 **Defaults by paradigm.** The recommended defaults, when omitted:

| Layer kind                         | `popOn`                          | `onMiss`                    |
|------------------------------------|----------------------------------|-----------------------------|
| Predicate-driven (no `popOn`)      | n/a (lives by predicate)         | `'fall-through'`            |
| Leader (vim-style)                 | `['resolution', 'timeout']`      | `'pop-and-fall-through'`    |
| Hydra (Emacs-style)                | `['miss-or-cancel', 'timeout']`  | `'pop-and-discard'`         |
| Modal-hold (e.g. `LB-shifted`)     | `['predicate']` (implicit)       | `'fall-through'`            |

4.7.4 The cancel gesture for `'miss-or-cancel'` is by default `tap('B')`, configurable per layer via `cancelGesture: Gesture` (omitted from §4.2 for brevity; see types module).

### 4.8 App-wide confirm/cancel convention

4.8.1 Anywhere a user-facing flow has a discrete *confirm* and *cancel* (modal dialogs, sub-modes, free-form entry buffers, multi-step pickers, takeover flows), the gamepad bindings follow a single, fixed convention:

- **Confirm** → `tap('Start')`
- **Cancel** → `tap('Back')` (the Select/View button on Xbox-style controllers; Share on PlayStation-style)

4.8.2 This convention overrides ad-hoc per-feature choices. Existing specs that bind these actions explicitly (e.g. [radial-menu.md §14.3 / §14.4](radial-menu.md), [live-edit.md §3.7.8](live-edit.md)) align with it. New specs SHOULD reference §4.8 rather than re-stating the bindings, so the convention has one normative home.

4.8.3 **Keyboard counterparts.** `Enter` is the keyboard confirm; `Esc` is the keyboard cancel. These are application-wide and do not require per-feature rebinding.

4.8.4 **Why these buttons.** `Start` and `Back` sit on the gamepad's centre cluster, away from face buttons and triggers used for in-flow actions (A/B/X/Y for verbs, sticks for navigation). Reserving them for confirm/cancel means a user can always exit or commit without disturbing the verb layer they're currently using, and their motor pattern transfers across every flow in the app.

4.8.5 **Out of scope.** Continuous actions (slurp, barf, nav.next, manual-control) have no confirm/cancel — they are eager-with-undo (§5). The convention applies only to flows that *gate* mutation behind explicit user assent.

---

## 5. Eager-with-undo dispatch

### 5.1 Reversibility

5.1.1 Every action has a **reversibility** classification:

```ts
const reversibleActions = [
  'edit.slurpForward', 'edit.slurpBackward',
  'edit.barfForward',  'edit.barfBackward',
  'edit.raise', 'edit.splice',
  'edit.enclose.list', 'edit.enclose.vector', 'edit.enclose.map', 'edit.enclose.set',
  'edit.transposeNext', 'edit.transposePrev',
  'edit.delete', 'edit.fillHole',
  'menu.verb.insert', 'menu.verb.replace', 'menu.verb.wrapWith', 'menu.verb.call',
  // ...
] as const

const irreversibleActions = [
  'eval.now',
  'mode.insert', 'mode.structural', 'mode.toggle',
  'transport.start', 'transport.stop',
  'picker.select', 'picker.cancel',
  // ...
] as const

type ReversibleActionId   = typeof reversibleActions[number]
type NonReversibleActionId = typeof irreversibleActions[number]
type ActionId             = ReversibleActionId | NonReversibleActionId
```

5.1.2 An action is **reversible** if and only if invoking it pushes exactly one entry onto the editor's undo stack, such that calling `editor.undo()` returns the document and cursor set to the pre-invocation state. The `reversibleActions` list is the type-level source of truth.

5.1.3 The action registry (`src/lib/keybindings/actions.ts`) carries this classification per entry. The literal-union types are derived from the registry; adding an action requires updating the registry and recompiling.

### 5.2 Tap commitment timing

5.2.1 When `tap` on a button has **no** `hold` and **no** `doubleTap` peer in the matched layer, tap commits **eagerly on press**. Zero perceived latency for the common case.

5.2.2 When `tap` has a `hold` peer (a `DualBinding` with both fields), the tap action MUST be `ReversibleActionId`. Compile-time error otherwise. Behaviour:
- On press: fire `tap` action eagerly.
- Start the hold timer (`T_hold = 250 ms`).
- If the button is released before the timer expires, the timer is cancelled; the tap action is left committed.
- If the timer expires while the button is still held: call `editor.undo()` exactly once, then dispatch the `hold` action. The user perceives a brief flicker on the rare hold path; the common tap path has no latency.

5.2.3 When `tap` has a `doubleTap` peer, the dispatcher defers tap commitment until the double-tap window (`T_doubleTap = 300 ms`) closes after the first release. If a second press arrives within the window, fire `doubleTap`; otherwise fire `tap`. (No undo gymnastics here — tap simply waits, accepting up to ~300 ms latency on the dual case.)

5.2.4 When `tap` has both a `hold` peer **and** a `doubleTap` peer: behaviour is the union — eager-on-press tap with hold-undo-rollback (5.2.2), and additionally the eager tap is rolled back if a second press arrives within the double-tap window. This is permitted only if the `tap` action is reversible.

5.2.5 `held` (auto-repeat) and `hold` are mutually exclusive per button (§3.2.3). When `tap` has a `held` peer, the recognizer fires `tap` eagerly on press, then begins emitting `held` ticks after the initial repeat delay. The tap action is **not** rolled back when `held` fires — they are intended to dispatch *the same* underlying user intent (e.g. `nav.next` on both tap and held, where the held repeats are simply more of the same action). If the dual binding has a different action for `held` than for `tap`, the user must accept that both actions fire.

### 5.3 Action dispatch

5.3.1 The dispatcher is the single component allowed to mutate state. It receives `Resolution` records from Stage 3 and:
- Dispatches actions through the existing action runner (which routes to the runtime, editor, etc.).
- Applies eager-with-undo timing.
- Pushes / pops transient layers via `gamepadStateStore`.
- Updates `gamepadStateStore.heldButtons` from press/release events.

5.3.2 The dispatcher is the **only** place that calls `editor.undo()` on behalf of the gamepad system. The undo it triggers is indistinguishable from a user-initiated undo as far as the editor knows.

---

## 6. Paradigms (informative)

This section sketches four ready-made binding setups. They are *examples* — the user is expected to fork, mix, and mutate them. Each is a separate file under `src/lib/gamepad/paradigms/` and exports a `Layer[]`.

### 6.1 Modal-shift

> `LB` and `RB` (held) act as keyboard-style modifier keys. The default layer covers ~14 buttons; each shift doubles the vocabulary. Tap-only on most buttons; one or two `tap+hold` pairs for power moves.

```ts
const baseLayer: Layer = {
  name: 'modal-base',
  when: () => true,
  gestures: {
    [keyOf(tap('Up'))]:    'nav.out',
    [keyOf(held('Up'))]:   'nav.out',
    [keyOf(tap('Down'))]:  'nav.in',
    [keyOf(tap('A'))]:     'edit.fillHole',          // gamepad-only stays in structural mode
    [keyOf(tap('Start'))]: 'eval.now',
    // Note: mode.insert is intentionally NOT bound in any default gamepad paradigm
    // — insertion mode is keyboard-only by intent (structural-editing §4.2.1). Free-form
    // text and digit entry happen through the radial menu's numpad/T9 sub-modes.
    // ...
  },
  axes: { right: 'manual-control' },
}

const lbShifted: Layer = {
  name: 'modal-lb',
  when: state => state.gamepad.heldButtons.has('LB'),
  gestures: {
    [keyOf(tap('A'))]:     'edit.slurpForward',
    [keyOf(tap('B'))]:     'edit.barfForward',
    [keyOf(tap('Up'))]:    'nav.first',
    // ...
  },
}
```

Layer order in the stack: `modal-lb` (or `modal-rb`, `modal-lb-rb`) above `modal-base`. The `LB`-button itself binds nothing on `modal-base` — its sole role is to shift the layer.

### 6.2 Leader (vim)

> A small set of "leader" buttons (here `tap('Y')`) opens a transient layer whose first match fires and pops. Maximises vocabulary on a small button surface; adds latency for leader-prefixed actions.

```ts
const leaderBase: Layer = {
  name: 'leader-base',
  when: () => true,
  gestures: { /* frequent direct ops on bare buttons */ },
  leaders: {
    [keyOf(tap('Y'))]: 'after-Y',
  },
}

const afterY: Layer = {
  name:   'after-Y',
  popOn:  ['resolution', 'timeout'],
  ttlMs:  800,
  onMiss: 'pop-and-fall-through',
  gestures: {
    [keyOf(tap('A'))]: 'edit.enclose.list',
    [keyOf(tap('X'))]: 'edit.enclose.vector',
    [keyOf(tap('B'))]: 'system.cancelLeader',  // explicit cancel
  },
}
```

Recursive nesting (a leader inside `after-Y` opening a deeper layer) is supported by giving `after-Y` its own `leaders:` section.

### 6.3 Hydra (Emacs)

> A leader opens a "sticky" layer: bound gestures keep firing, the layer survives, and only an unbound gesture (or explicit cancel / timeout) pops it. Designed for repeated operations in close succession (e.g. nudging a value, slurping repeatedly).

```ts
const hydraSlurp: Layer = {
  name:   'hydra-slurp',
  popOn:  ['miss-or-cancel', 'timeout'],
  ttlMs:  2000,
  onMiss: 'pop-and-discard',
  gestures: {
    [keyOf(tap('Right'))]: 'edit.slurpForward',
    [keyOf(tap('Left'))]:  'edit.slurpBackward',
    [keyOf(tap('Up'))]:    'edit.barfBackward',
    [keyOf(tap('Down'))]:  'edit.barfForward',
    [keyOf(tap('B'))]:     'system.cancelLeader',
  },
}
```

Triggered from a base layer with `leaders: { [keyOf(tap('LeftStickPress'))]: 'hydra-slurp' }`. The user can hammer `Right` repeatedly without re-pressing the leader.

### 6.4 Chord-heavy

> Most operations are 2-button chords. No layer-shifting, no leaders, no `held`-vs-`hold` ambiguity. Steep learning curve; fast once internalised; entirely flat resolution.

```ts
const chordLayer: Layer = {
  name: 'chord',
  when: () => true,
  gestures: {
    [keyOf(tap('Start'))]:           'eval.now',
    [keyOf(chord(['LB', 'A']))]:     'edit.slurpForward',
    [keyOf(chord(['LB', 'B']))]:     'edit.barfForward',
    [keyOf(chord(['LT', 'A']))]:     'edit.raise',
    [keyOf(chord(['LT', 'RT']))]:    'edit.splice',
    [keyOf(chord(['RB', 'Start']))]: 'mode.toggle',
    [keyOf(tap('Up'))]:              'nav.out',
    [keyOf(tap('Down'))]:            'nav.in',
    // ...
  },
}
```

### 6.5 Picker layer (always present)

> Ships orthogonal to whichever of 6.1–6.4 the user picks. Activates declaratively whenever a menu or radial picker is open; binds gestures to `picker.*` actions. Same actions are bindable on the keyboard.

```ts
const pickerLayer: Layer = {
  name: 'picker',
  when: state => state.menu.open,
  gestures: {
    [keyOf(tap('Up'))]:    'picker.move.up',
    [keyOf(tap('Down'))]:  'picker.move.down',
    [keyOf(tap('Left'))]:  'picker.move.left',
    [keyOf(tap('Right'))]: 'picker.move.right',
    [keyOf(tap('A'))]:     'picker.select',
    [keyOf(tap('B'))]:     'picker.cancel',
    [keyOf(tap('LB'))]:    'picker.apply.pre',
    [keyOf(tap('RB'))]:    'picker.apply.replace',
    [keyOf(tap('LT'))]:    'picker.apply',
    [keyOf(tap('RT'))]:    'picker.apply.call',
  },
  axes: { left: 'picker.angle', right: 'picker.angle' },
  onMiss: 'fall-through',  // bare buttons that have no picker meaning fall through
}
```

The picker layer sits at the top of the predicate-driven stack when active, masking conflicting bindings in the structural / base layers below.

---

## 7. State

### 7.1 The gamepad state store

```ts
// src/lib/gamepad/store.ts
type TransientLayerEntry = {
  readonly name:      LayerName
  readonly pushedAt:  number
  readonly expiresAt: number | null   // null when no 'timeout' policy
}

type GamepadState = {
  readonly heldButtons:     ReadonlySet<ButtonName>
  readonly transientLayers: readonly TransientLayerEntry[]
  readonly lastInputAt:     number
  readonly stickPositions:  Readonly<Record<StickName, { x: number; y: number }>>
}
```

7.1.1 `gamepadStateStore` is a Solid reactive store with the shape above. It is mutated **only** by the dispatcher. All other code reads it.

7.1.2 Layer `when:` predicates may read `gamepadStateStore` and any other reactive store. The predicate is invoked synchronously during stack composition; it MUST be pure and fast.

7.1.3 In tests, the store is replaced by a synthetic in-memory snapshot. `composeStack(snapshot, layers)` is a pure function and needs no reactive context.

### 7.2 Other stores read by predicates

Layer predicates routinely also read:
- `editorStateStore.mode` — `'structural' | 'insertion'`
- `menuStore.open`, `menuStore.kind`
- Settings store — for paradigm selection, sensitivity, timing constants

The `AppState` type used in spec examples is the *union* of all these (read-only projections). No central `AppState` object is constructed; layer predicates simply close over the stores they need.

---

## 8. Test harness

### 8.1 The contract

8.1.1 **Stage 1 (logical input)** is tested by feeding a synthetic snapshot sequence to the polling adapter and asserting the emitted `LogicalEvent[]`.

8.1.2 **Stage 2 (recognition)** is tested as a pure function: `recognize(LogicalEvent[]) → { gestures: Gesture[], axes: AxisFrame[] }`. No mocks, no timers, no DOM.

8.1.3 **Stage 3 (resolution)** is tested as a pure function: `resolve(gesture, snapshot, layers) → Resolution`. The `snapshot` is a plain object; `layers` is a plain array.

8.1.4 **Dispatcher** (eager-with-undo) is tested by feeding `Resolution` events through and asserting against a recorded action-call log and a fake undo handle.

### 8.2 Typed fixture builders

8.2.1 A `timeline()` builder produces `LogicalEvent[]` with full type safety:

```ts
const events = timeline()
  .press('A',   atMs(0))
  .press('LB',  atMs(50))
  .release('A', atMs(120))
  .release('LB',atMs(140))
  .axis('LeftStick', { x: 0, y: -0.8 }, atMs(200))
  .build()
```

8.2.2 Constructors `tap(...)`, `hold(...)`, `chord(...)`, `flick(...)` are reused in expected-output assertions:

```ts
expect(recognize(events).gestures).toEqual([
  chord(['A', 'LB']),
])
```

### 8.3 Property-based tests

8.3.1 Property tests use `fast-check` with arbitrary `LogicalEvent[]` generators. Required invariants:

- **Determinism.** `recognize(events) === recognize(events)`.
- **Time monotonicity respected.** A timeline whose events are not monotonically timestamped is rejected (or normalised) deterministically.
- **No phantom releases.** The recognizer never emits gestures referencing a button that was never pressed in the input.
- **Press / release matched.** Every `Hold` / `Held` / `Tap` resolves a real `press → release` (or `press → still-held-at-end-of-timeline`) pair.
- **Resolver purity.** `resolve(g, s, ls) === resolve(g, s, ls)` for any `(g, s, ls)`.

8.3.2 Optional invariants worth pursuing as paradigms mature:

- **Layer monotonicity.** Adding a layer to the bottom of the stack never changes the resolution of a gesture already bound by a higher layer.
- **Composability.** `recognize(eventsA ++ eventsB)` matches a checkpoint-aligned concatenation of the two pieces (modulo timer state crossing the boundary).

### 8.4 No-hardware contract

8.4.1 Every test that exercises gamepad behaviour MUST be runnable in a Node process with no `navigator`, no `window`, no real timers. Stage 1's hardware adapter is the ONLY component that touches `navigator.getGamepads()`; everything else is pure.

---

## 9. Implementation file layout

This section is informative — it sketches where the code lives. Migration from today's `src/lib/gamepadIntents.ts` is a clean rewrite, not an incremental change.

```
src/lib/gamepad/
  types.ts            // Gesture, Layer, ActionId types, branded names
  gestures.ts         // smart constructors (tap, hold, chord, ...) + keyOf
  recognizer.ts       // pure: LogicalEvent[] → { gestures, axes }
  resolver.ts         // pure: (gesture, state, layers) → Resolution
  dispatcher.ts       // eager-with-undo, action firing, store mutation
  store.ts            // gamepadStateStore (Solid)
  hardware.ts         // Stage 1 polling adapter (only impure I/O)
  paradigms/
    modal-shift.ts
    leader.ts
    hydra.ts
    chord-heavy.ts
    picker.ts         // always-present picker layer
  index.ts            // wiring

src/contracts/gamepadChannels.ts   // axis channel registry only

test/lib/gamepad/
  recognizer.test.ts
  resolver.test.ts
  dispatcher.test.ts
  paradigms.test.ts
  property.test.ts
```

---

## 10. Open / Deferred

10.1 **Action registry refactor.** The reversibility classification (§5.1) requires tagging every existing `ActionId`. The current `src/lib/keybindings/actions.ts` does not carry this metadata. Refactor scope is non-trivial; some actions (e.g. `eval.now`) are unambiguous, others (e.g. menu-driven inserts that themselves push a single edit) need adjudication.

10.2 **Keyboard <-> gamepad action symmetry.** The picker layer defines a richer `picker.*` action namespace than today's `pickerNavigate` / `pickerSelect` channels. Moving the picker subsystem onto action dispatch is a separate piece of work; until it lands, the picker layer's bindings can target the existing channels via a `{kind:'channel', ch:..., payload:...}` escape hatch (option B in the brainstorm — kept available as a migration aid, not the long-term shape).

10.3 **Multi-controller support.** All wording assumes a single connected gamepad. Multi-controller scenarios (two players, or split roles) are deferred. The store would gain a `controllerId` axis; bindings would gain optional controller filters.

10.4 **Rebinding UI.** The data model supports per-paradigm overrides and user-authored layers. Whether that ships as a settings UI in v1 or stays JSON-edit-the-file is open.

10.5 **Stick gesture richness.** Beyond `flick` and continuous `axis`, a stick can produce: angular taps (tapping a direction without crossing the flick threshold), circle gestures, pull-and-release (gesture-fishing). None of these are in the v1 vocabulary; if desired, they are future variants of `Gesture`.

10.6 **Cross-paradigm composition.** Can a user run "modal-shift base + leader for one specific button"? Yes, in principle, since both are just layer arrays. The ergonomics of authoring such mixes (and validating that the resulting stack has well-defined behaviour at every state) is an open UX question.

10.7 **`Held`-`Hold` exclusivity at the type level.** Today the rule is enforced by lint (`bindings load asserts no button has both`). Type-level enforcement would require encoding the per-button binding shape parametrically — possible but heavy. Lint is sufficient until paradigm authoring becomes a public surface.

10.8 **Sequence cancellation grace.** When a leader has been pushed and the user starts pressing a follow-up but releases too early or hits the wrong button, the experience is "the layer pops and your second press resolves against the lower stack." This is correct (per `'pop-and-fall-through'`) but may surprise. A "leader cancellation flash" (visual feedback when a leader pops without resolving) is worth considering.

10.9 **Axis channel arbitration when two layers bind the same stick to different channels.** Spec'd (§4.6.2): the topmost layer wins; lower bindings are ignored. The transition (channel A subscribes, then layer change makes channel B subscribe) needs to send a "release" frame `(0, 0)` to channel A so subsystems don't get stuck on a stale value. Implementation detail; should be specified explicitly once the dispatcher is written.
