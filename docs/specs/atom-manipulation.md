---
stability: evolving
layer: behavioural
---

# Atom manipulation

> Spec: contextual value editing for leaf nodes in structural mode. Covers LB/RB increment/cycle, symbol cycle groups, the cycling widget, joystick-driven float editing, and polarity flip. Counterpart to [MAIN.md](MAIN.md).
> See also [structural-editing.md](structural-editing.md) (the structural ontology and cursor model this builds on), [gamepad.md](gamepad.md) (input pipeline and paradigm bindings), [live-edit.md](live-edit.md) (the heavier-weight knob system for runtime-streamed values), [radial-menu.md](radial-menu.md) (content insertion — this spec covers content *mutation* of existing atoms).

### Source files

**Implemented:**

- `src/editors/extensions/structure/core/atomOps.ts` — pure atom manipulation operations (adjust, cycle, flipPolarity)
- `src/editors/extensions/structure/core/cycleGroups.ts` — symbol cycle group definitions
- `src/editors/commands/editorCommandRouter.ts` — `atomAdjust` / `atomFlipPolarity` command dispatch
- `src/lib/gamepad/paradigms/modal-shift.ts` — paradigm bindings (atom layer: LB/RB adjust, left-stick-press flip)

**Planned / not yet implemented** (see §3.7, §4, §6 status banners and §7 Open/Deferred):

- `src/editors/extensions/structure/adapter/atomController.ts` — CodeMirror integration (joystick float editing, cycling-widget lifecycle)
- `src/ui/atoms/CycleWidget.tsx` — the inline cycling widget component (§4)
- `src/ui/atoms/FloatScrubOverlay.tsx` — the joystick float editing overlay (§6)
- `src/contracts/gamepadChannels.ts` — `atom.rangeControl` / `atom.valueSelect` axis channels for float editing (§6); the file exists but these channels are not yet declared

---

## 1. Frame

1.1 **Atom manipulation** is the set of operations that modify the *value* of a leaf node in-place without changing its kind or its position in the tree. The user stays in structural mode; no insertion-mode round-trip is required. The cursor remains on the same node throughout.

1.2 The product use case is a performer who has already placed a value (a number, a symbol, a boolean) and wants to tweak it — try a different time scale, nudge a multiplier, flip a sign — without opening a menu or dropping into text editing.

1.3 Atom manipulation is a **structural-mode-only** feature. In insertion mode, the same buttons/sticks have their text-editing bindings. The predicate `cursor.isOnAtom && mode === 'structural'` gates all behaviour in this spec.

1.4 Atom manipulation and live-edit are complementary, not competing. Live-edit marks a value as runtime-streamable with a persistent knob; atom manipulation edits the *source text* directly. A live-edited value's seed can still be atom-manipulated (the cursor targets the seed literal inside the wrapper, per [structural-editing.md §6.5](structural-editing.md) Meta transparency).

1.5 All atom manipulation operations produce **standard structural edits** — they push onto the editor's undo stack, trigger reformatting per [formatting.md](formatting.md), and are composable with multi-cursor (per [structural-editing.md §3.5](structural-editing.md) pointwise application).

---

## 2. LB/RB Contextual Adjust

### 2.1 Dispatch by node kind

When the structural cursor is on a leaf node (not a compound, not the document root), LB and RB perform context-sensitive adjustment:

| Node kind | RB (adjust up / next) | LB (adjust down / prev) |
|-----------|----------------------|-------------------------|
| `number` (integer) | +1 | -1 |
| `number` (float) | +step (§2.2) | -step |
| `symbol` | cycle next in group (§3) | cycle prev in group |
| `keyword` | cycle next in known set (§3.8) | cycle prev |
| `boolean` (`true`/`false` symbol) | toggle (`true` ↔ `false`) | toggle |
| `hole` | no-op flash | no-op flash |
| `string` | no-op flash | no-op flash |

2.1.1 The dispatch is based on the node's **core kind** per [structural-editing.md §2.2](structural-editing.md). There is **no distinct `boolean` core kind** — `true` and `false` are `symbol` nodes in ModuLisp, so the `boolean` row above is a special case *inside* the `symbol` branch: the adjust handler checks for the literal symbols `true`/`false` and toggles them, otherwise it cycles within the symbol's group (§3). Metas are transparent — adjusting a quoted symbol (`'foo`) adjusts the symbol; the Meta rides along.

### 2.2 Number adjustment

2.2.1 **Integer step.** A number literal with no decimal point is treated as an integer. Step is always 1.

2.2.2 **Float step.** A number literal with a decimal point has its step derived from its precision: `step = 10^-(decimal_places)`. E.g. `0.5` → step 0.1; `0.25` → step 0.01; `1.0` → step 0.1.

2.2.3 **Range.** No hard clamp is applied. The user can adjust past zero into negatives and back. The operation simply adds/subtracts the step.

2.2.4 **Formatting preservation.** The replacement literal preserves the original's decimal format: adjusting `0.50` by +0.1 produces `0.60`, not `0.6`. Trailing zeros are maintained at the original precision.

2.2.5 **Held repeat.** LB/RB on numbers use `held` gesture (auto-repeat at 60ms interval after 300ms initial delay). This allows continuous adjustment by holding the button.

### 2.3 Boolean toggle

Either LB or RB flips `true` to `false` and vice versa. Both directions are equivalent — there's no "up" or "down" for booleans.

### 2.4 Interaction with modifier layers

2.4.1 LB/RB atom-adjust fires **only in the base layer, when neither LB nor RB is being held as a modifier**. The existing LB-held (slurp/barf) and RB-held (probes) layers take precedence when the button is sustained. The atom-adjust binding is on `tap('LB')` / `tap('RB')` in a predicate layer that activates when the cursor is on a leaf atom.

2.4.2 Concretely: tapping LB briefly adjusts the atom; holding LB enters the slurp/barf layer (the tap fires eagerly via the dual-binding system, but since atom-adjust is reversible, the undo-on-hold rollback works cleanly).

2.4.3 When the cursor is on a **compound** node, LB/RB tap has no atom-adjust binding — the tap falls through and the button acts purely as a modifier for the hold layer. This ensures existing compound-node workflows are unchanged.

---

## 3. Symbol Cycle Groups

### 3.1 Group definitions

A symbol belongs to at most one cycle group. Cycling advances through the group in a ring (wraps at boundaries). Groups are ordered — the order within each group defines the cycle sequence.

| Group ID | Members (in cycle order) | Rationale |
|----------|-------------------------|-----------|
| `phasors` | `beat`, `bar`, `phrase`, `section` | Temporal scale ladder |
| `phasor-durations` | `beat-dur`, `bar-dur` | Duration companions |
| `time-warps` | `fast`, `slow`, `offset` | Time-context transforms |
| `waveshapes` | `sin`, `cos`, `usin`, `ucos`, `tan`, `tri`, `sqr`, `pulse` | "Shapes you drive with a phasor" — all produce a periodic waveform from a 0→1 input |
| `oscillators` | `osc`, `tri-osc`, `saw`, `sqr-osc`, `lfo`, `phasor` | State-bearing oscillator UGens |
| `arithmetic` | `+`, `-`, `*`, `/`, `%` | Variadic arithmetic operators |
| `comparison` | `>`, `<`, `>=`, `<=`, `=` | Comparison operators |
| `logic` | `and`, `or`, `not` | Boolean logic |
| `sequencers` | `from-list`, `flatseq`, `interp` | List→value lookup variations |
| `gate-patterns` | `gates`, `gatesw`, `trigs`, `euclid` | Rhythmic pattern generators |
| `range-map` | `scale`, `clamp`, `lerp` | Value mapping / constraining |
| `smoothing` | `slew`, `one-pole`, `env-follow` | Signal conditioning |
| `random` | `random`, `index-rand`, `noise` | Non-deterministic sources |
| `range-convert` | `bi-to-uni`, `uni-to-bi` | Domain conversion pair |
| `rounding` | `floor`, `ceil`, `frac`, `abs` | Numeric shaping |
| `state` | `sah`, `toggle`, `count`, `integrate` | State-bearing primitives |
| `inputs` | `in1`, `in2`, `ain1`, `ain2` | Hardware inputs |
| `switches` | `swm`, `swt`, `swr`, `rot` | Hardware switch/encoder inputs |

3.1.1 Aliases are **not** separate group members. `seq` is an alias for `from-list`; `eu` is an alias for `euclid`; `shift` is an alias for `offset`; `latch` is an alias for `sah`. The cycle uses the primary name. If the user has written the alias in source, the first cycle step replaces it with the primary name.

3.1.2 `dm` (digital mapping) is a special form not easily grouped — it's left ungrouped.

### 3.2 Ungrouped symbols

A symbol not in any group produces a no-op flash on LB/RB. User-defined names (`define foo ...`) are never in a cycle group — cycling is for the language's built-in vocabulary only.

### 3.3 Arity awareness (informative)

Cycling from `sin` (1 arg) to `sqr` (1-2 args) to `pulse` (2 args) may leave the enclosing form with the wrong arity. This spec does **not** auto-fix arity — the change is a pure text substitution of the symbol. The user evaluates and sees a diagnostic if arity is wrong. Future: a post-cycle arity lint that inserts holes for missing args (see §7.1).

### 3.4 Group extensibility

The group definitions live in `src/editors/extensions/structure/core/cycleGroups.ts` as a typed data structure. A future setting `structure.userCycleGroups` could allow users to define additional groups or override built-in ones. Out of scope for v1.

### 3.5 Cycle direction

- **RB** = next (advance forward through the group order)
- **LB** = prev (advance backward)
- Wraps: after the last member, RB returns to the first; before the first, LB returns to the last.

### 3.6 Held repeat on symbols

Symbol cycling supports `held` repeat (same cadence as navigation: 300ms initial, 60ms interval). This allows rapid cycling through groups by holding the button.

### 3.7 Cycling widget (§4)

> **Status: deferred / not yet implemented.** See §4 and §7. The cycle operation
> currently produces the source-text change only; no widget is shown. The
> intended behaviour below describes the target design.

Every cycle operation (symbols and keywords) shows the cycling widget. Number adjust does **not** show the widget — the value change in the source text is sufficient feedback.

### 3.8 Keyword cycling

Keywords that appear as known option sets (e.g. `:sin`, `:tri`, `:saw`, `:sqr` for wave shape selectors) cycle through their known set. The known keyword sets are derived from the UGen keyword symbols in the language:

| Keyword group | Members |
|---------------|---------|
| `wave-keywords` | `:sin`, `:tri`, `:saw`, `:sqr` |

Keywords not in a known set produce a no-op flash.

---

## 4. Cycling Widget

> **Status: deferred / not yet implemented.** No `CycleWidget` component exists
> and `structure.cycleWidgetDismissMs` / `cycleWidgetNeighbours` /
> `showCycleWidget` (§4.6) are not in the settings schema. `atomAdjustAtCursor`
> in the command router consumes only the cycle result's `newText`; the
> `groupId` / `index` / `members` returned by `atomOps` are discarded (no widget
> event is emitted). This section specifies the target design.

### 4.1 Purpose

The cycling widget is a transient inline overlay that appears during symbol/keyword cycling to show the user where they are within the group. It provides spatial context — neighbours visible on both sides — so the user can anticipate what's coming without blind-stepping.

### 4.2 Appearance

```
      ‹ cos  tan 「usin」 ucos  sqr ›
```

- The **current value** is displayed in the centre, highlighted (bold, accent colour, surrounded by lenticular brackets or similar framing glyph).
- **2–3 neighbours** are visible on each side, rendered in the editor's monospace font at reduced opacity.
- **Directional arrows** (‹ ›) at the edges indicate more items exist in that direction. Hidden when at a boundary (wraps, so always shown for groups of size > visible window).
- The widget is horizontally centred on the cursor node's position.

### 4.3 Lifecycle

4.3.1 **Appears** on the first LB/RB tap that triggers a cycle operation.

4.3.2 **Updates** on each subsequent tap/held-repeat, scrolling the visible window to keep the current value centred.

4.3.3 **Dismisses** after `structure.cycleWidgetDismissMs` (default 800ms) of no further LB/RB input. Also dismisses immediately on any non-cycle input (navigation, A press, Start, etc.).

4.3.4 The widget does not block input — it's purely informational. All other operations are available while it's showing (they just dismiss it as a side effect).

### 4.4 Rendering

The widget renders as a CodeMirror tooltip (or equivalent floating overlay) positioned above the cursor node. It does not push document lines or change layout. Z-order: above cursor halos, below the radial menu.

### 4.5 Scrolling behaviour

The visible window scrolls to keep the current value centred. At the wrap point (end → beginning), the widget shows the transition naturally: `‹ ... pulse  sin 「cos」 usin  ucos ... ›` (the group is treated as circular for display purposes near the wrap).

### 4.6 Settings

- `structure.cycleWidgetDismissMs: number` — default 800. Idle timeout before widget disappears.
- `structure.cycleWidgetNeighbours: number` — default 3. Number of items visible on each side of the current value.
- `structure.showCycleWidget: boolean` — default true. Master toggle.

---

## 5. Polarity Flip (Left Stick Press)

### 5.1 Operation

When the structural cursor is on a `number` literal, pressing the left stick (L3 / LeftStickPress) flips the sign of the number:
- `5` → `-5`
- `-3.14` → `3.14`
- `0` → `0` (no-op; zero has no meaningful polarity — no-op flash)
- `0.0` → `0.0` (same — no-op flash on exact zero)

### 5.2 Implementation

The operation replaces the number literal in source:
- Positive → prepend `-` (the Lezer parser handles negative literals as a unary prefix; the operation produces `(neg X)` or a literal negative depending on the language's source representation). In ModuLisp, negative literals are written directly: `-5`, `-0.3`.
- Negative → strip the leading `-`.

### 5.3 Formatting

Precision is preserved: `-0.50` flipped to positive becomes `0.50`.

### 5.4 Non-number nodes

L3 on a non-number node retains its existing binding (`control.toggleManualLeft`). The polarity-flip binding is in a predicate layer that activates only when `cursor.nodeKind === 'number'`.

### 5.5 Reversibility

Polarity flip is reversible (undo restores the previous sign). It participates in the eager-with-undo system if needed.

---

## 6. Joystick Float Editing

> **Status: deferred / not yet implemented.** The `atom.rangeControl` /
> `atom.valueSelect` axis channels are not declared in
> `src/contracts/gamepadChannels.ts`, and the `atomController` /
> `FloatScrubOverlay` surface and `floatEdit*` settings do not exist. The atom
> layer in `modal-shift.ts` binds only the LB/RB tap-adjust and left-stick-press
> polarity-flip gestures (§2, §5); the sticks are not rebound on float leaves.
> This section specifies the target design.

### 6.1 Frame

When the structural cursor is on a floating-point number literal, both joysticks become a 2D value-editing surface. The left stick controls **range** (zoom + pan on the number line); the right stick selects a **value** within that range. Changes are reflected in the source text immediately but are not sent to any runtime until the user explicitly evaluates.

### 6.2 Activation

6.2.1 A predicate layer activates when:
- `mode === 'structural'`
- The primary cursor is on a `number` leaf whose text contains a decimal point (integer literals do NOT activate joystick editing — LB/RB integer stepping is sufficient for those)
- No radial menu, main menu, or other takeover modal is open

6.2.2 While active, the axis bindings for both sticks override their defaults:
- Left stick → `atom.rangeControl` axis channel
- Right stick → `atom.valueSelect` axis channel

6.2.3 When the cursor moves off the number (via D-pad or any navigation), the layer deactivates and sticks return to their default channels.

### 6.3 Right stick: value selection

6.3.1 **Velocity mode** (default). Right stick X-axis deflection controls the *rate of change*:
- Centre (deadzone) = hold current value
- Right deflection = increase value, rate proportional to deflection magnitude
- Left deflection = decrease value, rate proportional to deflection magnitude
- At full deflection, the value traverses the current range in approximately 2 seconds
- The Y-axis of the right stick is ignored for value editing

6.3.2 Why velocity mode over absolute positioning: absolute mode (stick position = value) makes it impossible to hold a precise value without perfect stick centering. Velocity mode lets the user nudge toward a target and release to hold. More compatible with analog stick drift.

6.3.3 **Step quantisation.** Value changes snap to the current step size (derived from precision, same as §2.2.2). This prevents jitter and produces clean source text.

### 6.4 Left stick: range control

6.4.1 **Y-axis: zoom.** Controls the active range width:
- Centre = maintain current range
- Push up = widen range (zoom out). Each frame at full deflection multiplies range width by ~1.02 (smooth exponential zoom). Max range: 10000× the initial range.
- Push down = narrow range (zoom in). Each frame at full deflection divides range width by ~1.02. Min range: step × 4 (prevents the range from collapsing below useful granularity).

6.4.2 **X-axis: pan.** Shifts the range centre:
- Centre = maintain current centre
- Push right = shift range centre upward (toward higher values)
- Push left = shift range centre downward (toward lower values)
- Pan rate is proportional to the current range width (so panning is always perceptually smooth regardless of zoom level)

6.4.3 **Initial range.** When joystick editing activates, the initial range is inferred from the current value using the same heuristics as live-edit range inference ([live-edit.md §3.4](live-edit.md)):
- `0 ≤ v ≤ 1` → range [0, 1]
- `-1 ≤ v < 0` → range [-1, 0]
- `v > 1` → range [0, 2v]
- `v < -1` → range [2v, 0]
- `v == 0` → range [0, 1]

### 6.5 Visual feedback

6.5.1 **Source text updates live.** The number literal in the document changes in real-time as the user moves the right stick. This is the primary feedback — the user sees the actual value they're producing.

6.5.2 **Range overlay.** While either stick is outside the deadzone, a compact overlay appears above the number showing:

```
   [0.0 ─────────●──── 1.0]   0.73
                  ↑ current    ↑ value readout
```

- A horizontal bar representing the current range (min on left, max on right)
- A dot/indicator showing the current value's position within the range
- Numeric labels at the range endpoints
- The current value displayed to the right

6.5.3 The overlay dismisses after 600ms of both sticks returning to deadzone.

### 6.6 Commit model

6.6.1 Joystick float editing produces **continuous source text edits** — each value change is a text replacement of the number literal. These edits are coalesced into a single undo entry: releasing the stick (returning to deadzone for 200ms) commits the undo group. The user can undo to restore the value before they started scrubbing.

6.6.2 **No runtime push.** The value exists only in source text until the user presses Start (eval). This is intentional — atom manipulation is source editing, not live performance control. For runtime-streamed values, use live-edit.

### 6.7 Interaction with live-edit

If the cursor is on a number that is the **seed** of a `live-edit` wrapper (i.e. the cursor has descended into the wrapper's payload via `nav.intoMeta`), joystick editing modifies the seed. The live-edit slot's *current value* is unaffected — only the source seed changes. After eval, the slot reinitialises from the new seed.

### 6.8 Settings

- `structure.floatEditMode: "velocity" | "absolute"` — default `"velocity"`. Whether right-stick is velocity-based or direct-position.
- `structure.floatEditSpeed: number` — default `2.0`. Seconds to traverse full range at maximum stick deflection (velocity mode).
- `structure.floatEditZoomRate: number` — default `1.02`. Per-frame multiplier for range zoom at full stick deflection.
- `structure.floatEditOverlayDismissMs: number` — default `600`. Idle timeout before the range overlay hides.

---

## 7. Open / Deferred

7.1 **Post-cycle arity lint.** When cycling changes a symbol to one with different arity, the enclosing form may have too few or too many arguments. A future enhancement could auto-insert holes for missing args or highlight surplus args with a diagnostic. Not in v1.

7.2 **User-defined cycle groups.** A setting `structure.userCycleGroups` allowing performers to define custom groups (e.g. their own set of named patterns, or project-specific function variants). Not in v1.

7.3 **Absolute mode for joystick.** The velocity mode is default; an absolute mode where stick position = value is available as a setting (§6.8) but the UX for precise value holding is worse. If user demand shows, reconsider.

7.4 **Multi-cursor float editing.** Joystick float editing with multiple cursors on different numbers: should all numbers change by the same delta, or should each track independently? Deferred until multi-cursor is more developed.

7.5 **Context-sensitive step for atom adjust.** For numbers inside known forms (e.g. the `n` parameter of `euclid` should step by 1 even if written as `16.0`), context-aware step inference could override the precision-based default. Deferred.

7.6 **Cycle widget animation.** Smooth scroll animation when cycling (items sliding left/right) vs. instant snap. Instant snap in v1; animation is a polish item.

7.7 **Joystick editing for integers.** Currently only floats activate joystick editing (integers use LB/RB stepping). If demand shows for large integer ranges (e.g. MIDI note numbers 0–127), joystick editing could activate for integers too. Deferred.
