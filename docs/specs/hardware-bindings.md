# Hardware Bindings

> Spec: editor-side machinery for binding ModuLisp expressions to hardware button/toggle/encoder events. Counterpart to [MAIN.md](MAIN.md).
> See also [live-edit.md](live-edit.md) (precedent for in-source wrapper forms with inline widgets), [structural-editing.md](structural-editing.md) (Metas, structural ops), [code-evaluation.md](code-evaluation.md) (eval lifecycle), [keybindings.md](keybindings.md) (action registry).
> Firmware counterpart: [../../src-useq/docs/specs/inputs.md](../../src-useq/docs/specs/inputs.md) (hardware input surface — `swm`/`swt`/`swr`/`rot`).

---

## 1. Frame

1.1 A **hardware binding** associates a ModuLisp expression with an event from a physical control on the connected uSEQ module — a button press, toggle flip, or encoder click. When the event fires, the editor dispatches the bound expression to the runtime for evaluation.

1.2 The product use case is the performer who wants the module's hardware controls to do *more* than feed signal values into code: pressing the button should *change* the patch (mute/unmute, swap a phasor, commit a knob, advance a sequence). Buttons become first-class macros.

1.3 Hardware bindings are **inline source annotations**. Bindings live in the document as wrapper forms — like `live-edit` — and travel with the patch. A patch IS a configuration: switching patches gets you a new set of bindings. Bindings are version-controlled, undoable, shareable, and visible in source.

1.4 Out of MVP scope: global (cross-patch) bindings; named/exportable binding *sets* divorced from the document; per-user binding profiles. If you want a button to do the same thing across many patches, define a snippet and reuse it. A future feature may layer global bindings on top (§8.1).

1.5 Hardware bindings are a main-editor feature. Tutorial playgrounds may opt in. Read-only secondary editors must not register bindings against hardware.

---

## 2. Source Surface

2.1 **Wrapper forms.** Three top-level wrapper forms cover the trigger surface:

```lisp
(on-press   <input-id> <body>)                        ; rising-edge handler
(on-release <input-id> <body>)                        ; falling-edge handler
(on-button  <input-id> (lambda (phase ms) <body>))    ; full-lifecycle handler
(on-toggle  <input-id> (lambda (state)    <body>))    ; toggle-state handler
```

- `<input-id>` — a keyword identifying the physical control (§2.4).
- `<body>` — for `on-press`/`on-release`, any expression evaluated for side effects.
- `on-button` body must be a 2-arg function `(lambda (phase ms) ...)` (§2.3).
- `on-toggle` body must be a 1-arg function `(lambda (state) ...)` (§2.5).

A `(do ...)` block is the natural way to compose multiple actions into a single binding (§2.7).

2.2 **`on-press` and `on-release` (edge handlers).**

- `on-press` fires once when the input transitions from inactive (up) to active (down).
- `on-release` fires once when the input transitions from active to inactive.
- Body is evaluated for side effects; the return value is discarded.
- A button can have an `on-press` binding, an `on-release` binding, or both, or neither — the three are independent slots in source.

2.3 **`on-button` (lifecycle handler).** A single binding form receives the full press-hold-release lifecycle in one callback:

- The body must be a function of two args: `phase` (a keyword) and `ms` (a number).
- `phase` is one of: `:press` (called once at rising edge; `ms` = `0`), `:hold` (called continuously while held, at the editor's UI tick rate; `ms` = ms since press), `:release` (called once at falling edge; `ms` = total hold duration).
- The function is dispatched as eval per phase tick. Hold-phase ticks are coalesced (§4.3) to avoid saturating the eval queue.

`on-button` is mutually exclusive with `on-press`/`on-release` for the same input — see §2.7. Use `on-button` when you need hold-while behaviour; use `on-press`/`on-release` when you need only the edges (most cases).

2.4 **Input-id keywords.**

| Keyword           | Hardware                                  | Variant            |
| ----------------- | ----------------------------------------- | ------------------ |
| `:sw1`, `:sw2`, … | Switches (momentary or toggle, per-variant) | All (count varies) |
| `:swr`            | Encoder switch (click)                    | `hardware_v0_2`    |
| `:in1`, `:in2`    | Digital gate inputs (edge events)         | All                |

Counts and presence are variant-dependent (see [../../src-useq/docs/specs/firmware.md §70](../../src-useq/docs/specs/firmware.md)). Encoder *position* (`(rot)`) is a continuous signal, not an event source — it has no `on-*` binding form (read it as a signal in regular code).

Variant validation:
- A binding to an input the connected variant does not expose is a **compile-time error** ("`:sw9` not available on this hardware variant"; suggestion: list available inputs). Mirrors the existing "unsupported input" rule from [../../src-useq/docs/specs/inputs.md §1.9](../../src-useq/docs/specs/inputs.md).
- When no hardware is connected (WASM-only), bindings still compile so the user can edit and test-fire (§5).

2.5 **`on-toggle` (toggle-switch handler).** For variants whose `:swN` is a sticky toggle (rather than a momentary button):

- The body must be a function of one arg: `state` (boolean — the new state after the flip).
- Fires on every state change in either direction.
- Encoder click (`:swr`) is always treated as momentary — no `on-toggle` form.

If the user binds `on-toggle` to a momentary switch (or `on-press` to a toggle that's defined to provide only state), the compiler emits a hint diagnostic naming the right form.

2.6 **Wrapper recognition.** All four forms are registered in `structure.builtinWrappers` ([structural-editing.md §6.2](structural-editing.md)). Each is treated as a wrapper Meta on its `<input-id>` keyword (the host); structural ops (`slurp`/`raise`/`transpose`/`wrap`) operate on the input keyword and the binding form follows. The body is a separate child node and structural ops can target it normally.

2.7 **One binding per (event, input).** For each `<input-id>`:
- At most one `on-press` form.
- At most one `on-release` form.
- At most one `on-toggle` form.
- An `on-button` form **excludes** `on-press` and `on-release` for the same input (overlapping semantics).

A second wrapper for the same `(event, input)` pair is a compile-time error ("`:sw1` already has an `on-press` binding at line 12; compose with `(do ...)`"). The user composes multiple actions inside a single binding using `(do ...)` or by calling helper fns. This keeps the source-as-truth principle: one form per slot, no silent stacking.

2.8 **Top-level only.** Binding forms must appear at the document's top level (or inside a top-level `do`). They are **not** valid inside `defn`/`defstate`/`let` bodies, `lambda`s, or signal contexts. The compiler rejects with an explanatory diagnostic. (Rationale: bindings are dispatch-time side effects, not signal-graph nodes.)

2.9 **Folding.** All four wrapper kinds fold by default — the wrapper text is replaced by an inline chip widget (§3). Insertion-mode escape (`mode.insert` while focused on a chip) reveals the raw form for hand-editing, mirroring [live-edit.md §2.5](live-edit.md).

2.10 **Multi-cursor.** Standard structural-edit semantics ([structural-editing.md §3.5](structural-editing.md)).

---

## 3. Inline Visual Surface

3.1 **Folded chip.** A bound form renders inline as a compact chip with three elements:

- **Button glyph** (`▇` or a small icon picked per input kind: button, toggle, encoder, gate). Identifies the input *kind* visually.
- **Input id** (`:sw1`, `:swr`). The label.
- **Status dot** (`●`). Idle is dim; pulses bright on each fire (200 ms decay).

```
▇ :sw1  ●          (on-press, idle)
▇ :sw2  ●          (on-toggle, just fired — dot bright)
◓ :swr  ●          (encoder click)
⤓ :in1  ●          (gate edge)
```

The chip is line-height tall (no popover-on-focus expansion — unlike live-edit knobs there is no value to scrub). Width is glyph + label + dot + small padding.

3.2 **Mode-aware variant of the chip.** If the binding form is `on-button` (lifecycle), the dot is replaced by a 3-segment indicator showing which phase last fired: `[ ● ○ ○ ]` for press, `[ ○ ● ○ ]` for hold, `[ ○ ○ ● ]` for release. This makes lifecycle bindings recognisable at a glance.

3.3 **Cursor halo.** When the structural cursor is on a binding chip, the standard structural-mode cursor halo per [structural-editing.md §3.3](structural-editing.md) wraps the chip. Halo is the cursor; the chip's own visual layer is identity + state.

3.4 **Unfolded view.** Insertion-mode escape (`mode.insert` on a chip) replaces the chip with the raw wrapper text and places the caret inside the body. Re-entering structural mode re-folds.

3.5 **Fired-pulse animation.** On every fire, the dot transitions from idle to bright over ~50 ms then decays linearly to idle over ~150 ms. Multiple fires within the decay window restart the animation (no stacking glow). The pulse is the user's primary feedback that the binding ran.

3.6 **Error state.** If the bound expression raised a diagnostic on its last fire, the chip shows a warning glyph instead of the dot, and the chip's halo tone shifts to the diagnostic colour. Hover/focus reveals the last error message inline. Cleared on the next successful fire.

3.7 **Inline widgets get no rename / reorder affordance.** There is no panel for hardware bindings (per §1.3 — bindings are pure source). Editing a binding means editing the form itself in source.

---

## 4. Runtime Semantics

4.1 **Eval dispatch.** When an event fires (real hardware press, or test-fire — §5), the editor:
1. Looks up the binding for `(event, input-id)` in the compiled program's binding table.
2. Submits the bound expression to the runtime as a top-level eval (immediate strategy; see [code-evaluation.md](code-evaluation.md)).
3. Treats the result as discarded and any diagnostic as a per-binding error (§3.6).

4.2 **Edge detection.** The editor maintains the previous state of each bound input from the existing visualisation/sample stream (or a dedicated state stream if vis is off). Edges are detected client-side; `on-press`/`on-release`/`on-toggle` fire on the editor's UI tick that observes the transition. The exact wire path is an implementation detail; a future firmware-side push of edge events ([MAIN.md §5.2](MAIN.md)) is a possible optimisation but not required by this spec.

4.3 **Re-trigger queue.** Each binding has an independent FIFO eval queue:
- Default depth: `4` (setting `hardware.bindingQueueDepth`, §6.3).
- A press with no eval in flight starts evaluating immediately.
- A press while an eval is in flight is queued.
- A press received with the queue full is **dropped**, with a console warning: `binding :sw1 dropped 1 event: queue full (depth 4)`. Repeated drops within 1 s collapse into a single warning with a count.
- The queue drains FIFO as in-flight evals complete.

For `on-button` lifecycle bindings, hold-phase ticks are **coalesced**: while a hold-phase eval is in flight, subsequent hold ticks set a "pending" flag with the latest `ms` value; on completion the next hold tick fires once with the pending `ms`. `:press` and `:release` events bypass coalescing and use the queue per the rule above.

4.4 **Soft-eval interaction.** A binding compiled in a soft-eval ([code-evaluation.md §1.1](code-evaluation.md)) is registered on WASM only and fires only against WASM until a normal eval lifts the binding to hardware. The chip enters `wasm-preview` state during this window (mirrors the live-edit `wasm-preview` state).

4.5 **Error semantics.** A bound expression that throws does not stop the music — it falls back to LKG on whatever outputs it touched and surfaces a diagnostic ([MAIN.md §2.1](MAIN.md)). Other bindings remain healthy. Repeated errors do not auto-disable the binding; the user must edit the source.

4.6 **Runtime disconnect.** If the active runtime disconnects mid-session, queued events drain to a single console warning and are discarded. Live state-edge detection pauses. On reconnect, a fresh edge from the next press will fire normally; missed presses during the disconnect are *not* replayed.

---

## 5. Test-Fire UX

5.1 **Click-and-hold the chip's status dot** to simulate a press from the editor:
- `mousedown` on the dot dispatches `:press` at `ms=0` (or `on-press` for edge bindings).
- Continued hold dispatches `:hold` ticks at the UI tick rate, with real elapsed `ms`. (`on-press`/`on-release` bindings ignore hold; `on-button` receives the lifecycle.)
- `mouseup` dispatches `:release` (or `on-release` for edge bindings) with total `ms`.
- For `on-toggle` bindings, `mousedown` fires once with the toggled state (UI maintains a virtual toggle latch per chip; the latch is per-session, not persisted).

5.2 **Test-fire is indistinguishable from a real press** from the runtime's perspective. The same eval queue (§4.3) handles both. The status pulse animates identically. This means dev mode (WASM-only) gives a faithful preview of how the binding will feel on hardware.

5.3 **Keyboard / gamepad equivalent.** When the structural cursor is on a binding chip, the `hardware.testFire` action (registered in [keybindings.md](keybindings.md)) fires the binding. Default key bindings: keyboard space, gamepad south face. Held = lifecycle hold; tap = press+release.

5.4 **No persistent test-mode toggle.** Test-fire is a discrete gesture — there is no global "test mode" that changes runtime behaviour. The hardware, when connected, continues to fire bindings in parallel with any test-fire from the UI. If the user holds a virtual press while the hardware presses too, both events queue independently.

---

## 6. Settings

Hardware-binding-related settings live under `hardware.*`:

6.1 `hardware.bindingsEnabled: boolean` — default `true`. Master switch; when off, all bindings are inert (chips render in a disabled tone; events do not dispatch).

6.2 `hardware.bindingFoldDefault: boolean` — default `true`. Whether `on-press`/`on-release`/`on-button`/`on-toggle` wrappers fold to chips by default. The global `structure.foldAllWrappers` setting takes precedence per [structural-editing.md §6.2](structural-editing.md).

6.3 `hardware.bindingQueueDepth: number` — default `4`. Max queued events per binding before drops (§4.3). Set to `1` for strict "no overlap" semantics; set to `0` for fire-and-forget (no queue, every press dispatches independently — beware runtime saturation).

6.4 `hardware.holdTickHz: number` — default `30`. UI tick rate for `on-button` `:hold` phase dispatch. Coalesced if the runtime cannot keep up (§4.3).

---

## 7. Failure Modes and Diagnostics

7.1 **Compile-time errors** (block the eval; surface as inline diagnostics):
- Wrapper at non-top-level position (§2.8).
- Unknown `<input-id>` for the connected variant (§2.4). When no hardware is connected, this is downgraded to a warning.
- Conflicting binding for the same `(event, input)` slot (§2.7).
- `on-button` body that is not a 2-arg function; `on-toggle` body that is not a 1-arg function.
- Typo in the wrapper head (`on-pres`, `on-tooggle`) — fuzzy-match suggestion per the diagnostic system.

7.2 **Compile-time warnings:**
- `on-toggle` bound to a switch the connected variant exposes only as momentary (or vice versa) — eval succeeds, but the binding never fires; surface a hint suggesting the right form.
- Bound expression has no observable side effects (e.g. `(on-press :sw1 42)` — the body is pure and discards) — warn but allow.

7.3 **Runtime errors** are per-binding and follow [MAIN.md §2.1](MAIN.md): LKG on touched outputs, diagnostic surfaced inline (§3.6) and to console.

7.4 **Disabled hardware.** With `hardware.bindingsEnabled = false` (§6.1), bindings render as dimmed chips with a disabled glyph and do not dispatch on either real or test-fire events.

---

## 8. Open / Deferred

8.1 **Global (cross-patch) bindings.** A future "macro" layer that lets a user define button bindings that persist regardless of which patch is loaded. Out of v1 — the in-source story is enough for the demo. Likely shape: a settings-stored map keyed by `:sw1`/etc., applied if the current document does not already bind that input.

8.2 **Gate-edge bindings on `:in1`/`:in2`.** Edge handlers on the digital gate inputs are listed in §2.4 but not yet validated end-to-end. They reuse the same edge-detection mechanism as switch bindings; the only delta is that gates can edge much faster than human button presses, increasing the importance of §4.3 queue management. Confirmed in scope but flagged for verification under pulsed input.

8.3 **Encoder rotation as event source.** `(rot)` is a continuous signal, not an event source (§2.4). A possible future `on-rot-step` binding could fire on each detent click of the encoder. Out of v1 — read `rot` as a signal in regular code.

8.4 **Velocity / pressure on bindings.** No binding form receives "how hard" the button was pressed (uSEQ buttons are digital). If future hardware exposes pressure or velocity, a `:velocity` arg to the lifecycle callback is the natural extension.

8.5 **Inspector / Storybook story.** Binding chips should be renderable in isolation per the props-based UI conventions in `CLAUDE.md` (`inputId`, `kind` (`press`/`release`/`button`/`toggle`), `state` (`idle`/`fired`/`error`/`disabled`), `onTestFire` props). Wired adapter pulls from the binding store. Not yet specified beyond this note.

8.6 **Discoverability of available input-ids.** Today the user has to know that `:sw1`, `:swr`, etc. exist. A future improvement: an inline picker or autocomplete showing the connected variant's input map. Tracked but not gating MVP.
