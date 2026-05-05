# Superbooth 2026 Demo Runbook

Practical script for demoing uSEQ Perform at the booth. Three acts, ~4 minutes total walkthrough. Each act is self-contained so you can skip or reorder based on the attendee's interest.

---

## Setup Checklist

- [ ] uSEQ module powered and patched (at least one output to a speaker/scope)
- [ ] USB cable from module to laptop
- [ ] Xbox-style gamepad connected via USB or Bluetooth (verify LED active)
- [ ] Chrome/Chromium open, `https://useq-perform.localhost` loaded
- [ ] MIDI controller plugged in (any CC-capable knob box; 4+ knobs ideal)
- [ ] Serial connected (toolbar shows green transport indicator)
- [ ] Editor has the **opening patch** loaded (see below)
- [ ] Visualisation panel open (right dock), showing live traces
- [ ] Live-edit panel closed (will open in Act 2)

### Opening Patch (what's on screen when attendees walk up)

A small working patch that already produces sound/CV, with room to grow:

```lisp
(define lfo (saw 0.25))
(a1 lfo)
(d1 (square 4))
```

This gives one visible oscilloscope trace (a1) and a blinking digital output (d1). The vis panel shows both, the code is readable at a glance, and there are obvious extension points.

---

## Act 1: Structural Editing with Gamepad (~90 seconds)

**Story**: "You can write and reshape code without touching the keyboard."

### Opening move

1. Pick up the gamepad. The structural cursor (halo) should already be on `lfo` or `(saw 0.25)`.

### Sequence

| Step | Gesture | What happens | Say |
|------|---------|--------------|-----|
| 1 | D-pad left/right | Cursor moves between siblings | "D-pad navigates spatially between expressions." |
| 2 | D-pad up | Cursor ascends to parent | "Up goes to the parent form." |
| 3 | D-pad down | Cursor descends into children | "Down enters the form." |
| 4 | Navigate to `0.25` | Cursor on the frequency literal | "Let's change this frequency." |
| 5 | **X** (tap) | Radial menu opens (full-screen overlay) | "X opens the radial menu -- this is how you insert content without typing." |
| 6 | Left stick to "Numbers" category, right stick to `100` | Category and item highlighted | "Left stick picks category, right stick picks the item." |
| 7 | **LT** (apply verb: Replace) | Menu closes, `0.25` becomes `100` | "Left trigger replaces. The frequency jumps to 100." |
| 8 | **Start** | Eval fires | "Start evaluates -- hear the change." |
| 9 | Navigate to `(saw 100)`, hold **LB** | Shift into slurp/barf layer | "Holding LB gives me structural verbs..." |
| 10 | **LB + A** | `edit.slurpFwd` -- the next sibling is pulled in | "A slurps forward -- pulls the next expression inside." |
| 11 | Hold **LB + RB**, tap **Up** | `edit.wrapList` -- wraps selection in parens | "Both bumpers held: Up wraps in a list." |
| 12 | **Start** | Eval | "Evaluate again and we hear the new structure." |

### Recovery

- If the radial menu is stuck open: **B** cancels.
- If you slurped the wrong thing: **LB + B** barfs it back out.
- If the eval errors: the vis shows a diagnostic squiggle inline; just undo (keyboard Ctrl-Z or RB+Back) and try again.

---

## Act 2: Live-Edit + MIDI Learn (~90 seconds)

**Story**: "Any number in your code becomes a physical knob."

### Sequence

| Step | Gesture | What happens | Say |
|------|---------|--------------|-----|
| 1 | Navigate cursor to a numeric literal (e.g. `100` or `4`) | Cursor halo on the number | "I'll turn this number into a live knob." |
| 2 | Trigger `liveEdit.mark` (keyboard shortcut or gamepad chord) | Number wraps in `(live-edit ...)`, inline knob appears | "Now it's a live-edit -- see the knob inline?" |
| 3 | Right stick X-axis | Value changes in real-time, sound/CV updates immediately | "Right stick drives the value. No recompile -- it streams straight to hardware." |
| 4 | Mark a second literal the same way | Second inline knob appears | "Let's do another one." |
| 5 | Open the live-edit panel (toolbar button or keybinding) | Right-dock panel slides in showing both knobs as cards | "The panel shows all active knobs with bigger controls." |
| 6 | Click **LEARN** on first card | Card pulses (listening state) | "Now I'll bind a MIDI controller..." |
| 7 | Turn a physical knob on the MIDI controller | Binding completes, label shows `CC1` (or whichever) | "Done. That physical knob now drives this value." |
| 8 | Click **LEARN** on second card, turn another knob | Second binding made | "And another." |
| 9 | Twist both MIDI knobs simultaneously | Both values stream, vis traces respond in real-time | "Both stream at 60 Hz to hardware. No latency you can hear." |

### Recovery

- MIDI not detected: check browser MIDI permission prompt (Chrome shows it once).
- Wrong knob bound: click the binding label on the card, choose "Re-learn."
- Widget shows "no runtime" state: press Start to eval; the slot registers on next successful compile.

---

## Act 3: Serial Visualisation (~60 seconds)

**Story**: "You can see what your code will do before it happens."

### Sequence

| Step | Gesture | What happens | Say |
|------|---------|--------------|-----|
| 1 | Point at the vis panel (already showing traces) | Traces visible: past on left, future on right | "The centre line is *now*. Left is recorded history, right is predicted future." |
| 2 | Turn a live-edit knob (MIDI or gamepad) | Both past and future traces update; future recomputes | "Watch the future half update as I change a parameter." |
| 3 | Evaluate a new expression (change the `saw` to `sine`) | Past trace shows discontinuity at the change point | "See the boundary -- past shows what actually happened; future shows the new behaviour." |
| 4 | Point out digital vs analogue lanes | Step traces (d1) vs smooth traces (a1) | "Digital outputs render as steps; analogue as smooth curves." |
| 5 | If probes are set up: toggle a probe (RB+A) on a sub-expression | New trace appears in vis | "I can probe any sub-expression to see its waveform too." |

### Recovery

- Vis panel blank / "No expressions selected": press Start to eval, traces should appear.
- Traces stuttering: adaptive quality will kick in automatically; if severe, reduce `visualisation.sampleCount` in settings.

---

## Timing Summary

| Act | Duration | Can skip? |
|-----|----------|-----------|
| 1 - Structural editing | ~90 sec | No (headline feature) |
| 2 - Live-edit + MIDI | ~90 sec | Yes (if no MIDI controller) |
| 3 - Visualisation | ~60 sec | Yes (always visible anyway) |
| **Total** | **~4 min** | |

For a quick drive-by (attendee has 60 seconds): do Act 1 steps 1-8 only (navigate + radial menu + eval). The vis is already running in the background as a visual hook.

---

## Gamepad Quick Reference (Modal-Shift Paradigm)

### Base layer (no modifiers)

| Button | Action |
|--------|--------|
| D-pad | Spatial navigation (up/down/left/right between nodes) |
| A | Navigate into child (nav.in) |
| B | Navigate to parent (nav.out) |
| X | Open radial menu |
| Y | Delete node |
| Start | Evaluate |
| LB+A chord | Open menu before cursor |
| RB+A chord | Open menu after cursor |
| Right stick | Manual control axis |

### LB held (slurp/barf layer)

| Button | Action |
|--------|--------|
| A | Slurp forward |
| B | Barf forward |
| X | Slurp backward |
| Y | Barf backward |
| Up | Home (first sibling) |
| Down | End (last sibling) |
| Start | Eval (quantised) |

### RB held (probe layer)

| Button | Action |
|--------|--------|
| A | Toggle probe |
| B | Toggle raw probe |
| X | Expand probe |
| Y | Contract probe |
| Start | Soft eval (WASM only) |
| Back | Redo |

### LB+RB held (shape verbs)

| Button | Action |
|--------|--------|
| A | Raise |
| B | Splice |
| X | Transpose backward |
| Y | Transpose forward |
| Up | Wrap in list `()` |
| Down | Wrap in vector `[]` |
| Left | Wrap in map `{}` |
| Right | Wrap in set `#{}` |

### Radial menu (while open)

| Input | Action |
|-------|--------|
| Left stick | Navigate categories (left ring) |
| Right stick | Navigate items (right ring) |
| LB | Apply: insert before |
| RB | Apply: insert after (replace) |
| LT | Apply (default verb) |
| RT | Apply: call |
| B | Cancel / close menu |
| A | Select / confirm |

### Global

| Button | Action |
|--------|--------|
| Start | Confirm (in sub-modes) |
| Back | Cancel (in sub-modes) |

---

## Emergency Recovery

| Situation | Fix |
|-----------|-----|
| Gamepad disconnected | Reconnect USB/BT; app auto-detects within 2 seconds |
| Serial disconnected | Click "Connect" in toolbar; re-select the port |
| App frozen / white screen | Cmd-R to reload; persisted state restores editor content and live-edit values |
| Eval error (red squiggle) | Ctrl-Z to undo last change, then re-eval with Start |
| Vis traces disappeared | Eval (Start) to re-register outputs |
| MIDI stopped responding | Check browser MIDI permissions; re-open page if needed |
| Sound cuts out | Check patch cables; verify module power; re-eval |

---
---

# Feature Verification Script

> Offline testing script for verifying features against the WASM runtime.
> Open the app with `npm run dev` in a browser. Use a gamepad where noted.
> Hardware-only features are in the final section.

---

<details>
<summary>

## - [ ] 1. Bootstrap & Runtime Modes

</summary>

The app should boot into a usable state within ~1 second, with WASM ready for eval within ~2 seconds. The editor should be interactive immediately — even before WASM finishes loading. Persisted code from your last session should appear in the editor on load.

### - [ ] 1.1 Cold start (WASM mode)

Open the app fresh (or with `?default` to force default code). The app should reach an interactive editor quickly.

```
URL: https://useq-perform.localhost/?default
```

**Verify:**
- [ ] Editor is visible and accepts keyboard input within ~1 second
- [ ] Connection indicator shows WASM-only mode (not "hardware connected")
- [ ] No blank page or silent failure — if something goes wrong, an actionable error message appears
- [ ] Console shows no errors on clean boot

### - [ ] 1.2 Eval readiness

Type a simple expression and eval it (Ctrl+Enter or Shift+Enter on the top-level form).

```lisp
(a1 (usin bar))
```

**Verify:**
- [ ] Eval fires successfully (eval flash animation on the form)
- [ ] Inline result appears briefly showing the return value
- [ ] Visualisation panel shows a trace for `a1`
- [ ] Console shows no errors

### - [ ] 1.3 `?nosave` mode

Open with `?nosave` — the app should read existing state but never write back.

```
URL: https://useq-perform.localhost/?nosave
```

**Verify:**
- [ ] Your previously-saved code appears in the editor (reads work)
- [ ] Make an edit, close the tab, reopen without `?nosave` — the edit is NOT persisted
- [ ] Onboarding banner dismissal is not saved either

### - [ ] 1.4 `?debug` and `?devmode`

```
URL: https://useq-perform.localhost/?devmode=true&debug=true
```

**Verify:**
- [ ] Settings panel shows additional "Advanced" sections not normally visible
- [ ] Browser console shows verbose debug logging from the app

### - [ ] 1.5 `?virtualGamepad=true`

```
URL: https://useq-perform.localhost/?virtualGamepad=true
```

**Verify:**
- [ ] A virtual Xbox-style gamepad overlay appears on screen
- [ ] Pressing virtual buttons produces the same effects as a real gamepad

</details>

---

<details>
<summary>

## - [ ] 2. Structural Editing — Navigation

</summary>

Structural editing is the primary interaction mode. The editor maintains a tree model of the code and lets you navigate/mutate it as nodes rather than characters. A coloured halo highlights the focused node. The text caret is hidden in structural mode.

### - [ ] 2.1 Spatial navigation (arrow keys / D-pad)

Start with this code (eval it first so the tree is clean):

```lisp
(a1 (+ (usin bar)
        (slow 2 (osc 440))))
```

**Verify (keyboard: arrow keys; gamepad: D-pad or left stick):**
- [ ] Left/Right moves through nodes in reading order (depth-first Euler tour) — you visit each compound twice (entering and leaving)
- [ ] Up/Down jumps to the nearest node on the line above/below, preferring same-column alignment
- [ ] Cursor halo clearly shows which node is focused
- [ ] No text caret is visible in structural mode
- [ ] No-op flash (subtle visual feedback) when you try to move past the document boundary

### - [ ] 2.2 Tree-level navigation

Using explicit tree-walking commands (Ctrl+Up/Down or gamepad layer):

```lisp
(a1 (+ (usin bar) (osc 440)))
```

**Verify:**
- [ ] `nav.out` (Ctrl+Up or equivalent) — moves focus to the parent node
- [ ] `nav.in` (Ctrl+Down) — moves focus to the first child of a compound
- [ ] `nav.next` / `nav.prev` — moves to next/previous sibling
- [ ] `nav.first` / `nav.last` — jumps to first/last sibling
- [ ] Repeated `nav.out` eventually reaches the document root; further attempts flash

### - [ ] 2.3 Hole navigation

Enter this code (don't eval — holes block eval):

```lisp
(slow ($ rate :number) (osc ($ freq :number)))
```

**Verify:**
- [ ] Holes render as inline pills: `[num·rate]` and `[num·freq]`
- [ ] `nav.nextHole` (Tab) jumps between holes in document order
- [ ] `nav.prevHole` (Shift+Tab) goes in reverse
- [ ] Cursor halo renders around the hole pill, not around the raw source text

### - [ ] 2.4 Mode switching

```lisp
(a1 (osc 440))
```

**Verify:**
- [ ] Focus on `440`, press the insert-mode key — text caret appears inside the node, halo disappears
- [ ] Type some characters (e.g. change to `880`) — standard text editing works
- [ ] Press Escape or the structural-mode key — returns to structural mode, halo reappears on the edited node
- [ ] Cursor position is preserved through the round-trip (lands on the node you were editing)

</details>

---

<details>
<summary>

## - [ ] 3. Structural Editing — Mutations

</summary>

Structural mutations rewrite the tree directly. Each mutation auto-reformats the affected top-level form. All mutations push onto the undo stack (Ctrl+Z undoes them).

### - [ ] 3.1 Slurp and Barf

```lisp
(+ 1 2) 3
```

Focus on `(+ 1 2)`.

**Verify:**
- [ ] Slurp forward — `3` moves inside: `(+ 1 2 3)`. Cursor stays on the list.
- [ ] Undo (Ctrl+Z) restores original
- [ ] Barf forward on `(+ 1 2 3)` — last child (`3`) moves out: `(+ 1 2) 3`. Cursor stays on the list.
- [ ] Slurp backward / Barf backward work symmetrically on the other side
- [ ] Barf on a list with only one child → no-op flash (needs ≥2 children)

### - [ ] 3.2 Raise and Splice

```lisp
(a1 (+ (usin bar) (osc 440)))
```

Focus on `(usin bar)`.

**Verify:**
- [ ] Raise — `(usin bar)` replaces its parent `(+ ...)`: result is `(a1 (usin bar))`. Cursor on the raised node.
- [ ] Undo, then focus on `(+ (usin bar) (osc 440))` and Splice — the `+` list dissolves, children become siblings: `(a1 (usin bar) (osc 440))`. Cursor on the first spliced child.

### - [ ] 3.3 Enclose (Wrap)

```lisp
(a1 440)
```

Focus on `440`.

**Verify:**
- [ ] Enclose in list — produces `(a1 (440))` with cursor on the new list (keyboard: enters insertion mode at head position so you can type the operator)
- [ ] Enclose in vector — produces `(a1 [440])` with cursor on the new vector
- [ ] From gamepad: enclose in list inserts a hole at the head: `(a1 ([sym·head] 440))`

### - [ ] 3.4 Transpose

```lisp
(+ alpha beta gamma)
```

Focus on `beta`.

**Verify:**
- [ ] Transpose forward — swaps with next sibling: `(+ alpha gamma beta)`. Cursor follows `beta`.
- [ ] Transpose backward — swaps with previous sibling. Cursor follows the moved node.
- [ ] At the boundary (first or last sibling) → no-op flash

### - [ ] 3.5 Delete and Cut

```lisp
(+ 1 2 3)
```

Focus on `2`.

**Verify:**
- [ ] Delete — removes the node: `(+ 1 3)`. Cursor moves to next sibling (or previous if last).
- [ ] Cut — removes node and places it on clipboard. Paste elsewhere inserts it.

### - [ ] 3.6 Fill hole

```lisp
(osc ($ freq :number))
```

Focus on the hole pill `[num·freq]`. Open the radial menu (tap Y on gamepad) or type a value.

**Verify:**
- [ ] Replacing the hole with a value (e.g. `440`) produces: `(osc 440)`
- [ ] The form can now be evaluated (holes block eval)
- [ ] If the replacement itself contains holes, cursor jumps to the first nested hole

### - [ ] 3.7 Ignore-form (`#_`)

```lisp
(a1 (usin bar))
(a2 (osc 440))
```

Focus on the `(a2 ...)` form. Apply the ignore Meta (toggle `#_` prefix).

**Verify:**
- [ ] The form becomes `#_(a2 (osc 440))` — visually marked as ignored
- [ ] The ignored form is still visible and navigable (not deleted)
- [ ] Evaluating the document skips the ignored form — `a2` is not sent to runtime
- [ ] The ignore Meta rides along through structural ops (move, transpose, etc.)
- [ ] Toggling again removes the `#_` prefix and restores normal evaluation

### - [ ] 3.8 Range cursors

```lisp
(+ 1 2 3 4 5)
```

Focus on `2`.

**Verify:**
- [ ] `nav.extendNext` — selection grows to include `3`: range cursor `[2, 3]`
- [ ] `nav.extendNext` again — range grows: `[2, 3, 4]`
- [ ] `nav.shrink` — releases the last-added end: back to `[2, 3]`
- [ ] Range halo visually spans all selected siblings
- [ ] Operations on a range: enclose wraps all of them, delete removes all, transpose swaps the block

### - [ ] 3.9 Gamepad enclose (insertion-mode guard)

With a gamepad as your active input device, focus on a node and trigger `edit.enclose.list`:

```lisp
(a1 440)
```

Focus on `440`, trigger enclose-in-list from gamepad.

**Verify:**
- [ ] Result is NOT an empty `()` with insertion mode — instead it's `([sym·head] 440)` with a hole
- [ ] You are NOT in insertion mode (no text caret appears)
- [ ] The radial menu auto-opens scoped to `:symbol` for filling the head hole
- [ ] A gamepad-only user never accidentally lands in insertion mode

</details>

---

<details>
<summary>

## - [ ] 4. Auto-Formatting

</summary>

After any structural mutation, the affected top-level form is automatically reformatted. The formatter uses width and complexity thresholds to decide single-line vs. multi-line layout. Inter-top-level whitespace (blank lines between forms) is never touched.

### - [ ] 4.1 Width threshold (default 60 chars)

Start with a short form that fits on one line:

```lisp
(a1 (+ (usin bar) (osc 440)))
```

Slurp several more arguments into the `+` to push it past 60 characters.

**Verify:**
- [ ] While under 60 chars, the form stays on one line after mutations
- [ ] Once it exceeds 60 chars, the formatter breaks it with arg-aligned indentation:
  ```
  (a1 (+ (usin bar)
          (osc 440)
          (slow 2 (tri bar))))
  ```
- [ ] The first argument stays on the same line as the head

### - [ ] 4.2 Complexity threshold

```lisp
(+ 0.1 0.2 0.3 0.4 0.5)
```

This has all-leaf children (weight 1) — should stay on one line regardless of count (unless width exceeded).

Now try:

```lisp
(+ (usin bar) (seq [1 2 3 4] (slow (from-list [3 2 4] (slow 8 bar)) bar)))
```

**Verify:**
- [ ] The deeply-nested form triggers breaking even if it could technically fit on one line
- [ ] The flat `(+ 0.1 0.2 0.3 ...)` form stays single-line (leaf-only children)

### - [ ] 4.3 `do` blocks always break

```lisp
(do (bpm 120) (a1 (osc 440)) (d1 (pulse bar)))
```

Perform any structural mutation on this form.

**Verify:**
- [ ] After the mutation, `do` children are always on separate lines with 2-space indent:
  ```
  (do
    (bpm 120)
    (a1 (osc 440))
    (d1 (pulse bar)))
  ```

### - [ ] 4.4 Inter-top-level whitespace preserved

```lisp
(bpm 120)


(a1 (osc 440))

(d1 (pulse bar))
```

Perform a mutation inside `(a1 ...)` (e.g. slurp something).

**Verify:**
- [ ] The blank lines between top-level forms are untouched
- [ ] Only the form you mutated gets reformatted

### - [ ] 4.5 Insertion mode: hands off

Enter insertion mode inside a form and manually type some oddly-formatted code. Exit back to structural mode.

**Verify:**
- [ ] Your typed layout is preserved exactly — no reformatting occurs on mode exit
- [ ] Only the next *structural* mutation on that form will reformat it

</details>

---

<details>
<summary>

## - [ ] 5. Code Evaluation

</summary>

Three eval strategies exist: immediate (default), quantised (synced to a phasor wrap), and soft (WASM preview only, no hardware send). Eval produces inline results, diagnostics on error, and output health tracking.

### - [ ] 5.1 Immediate eval

```lisp
(a1 (usin bar))
```

Press Ctrl+Enter (or equivalent eval key) with cursor anywhere in the form.

**Verify:**
- [ ] Eval flash animation highlights the evaluated range
- [ ] Inline result widget appears briefly showing the return value
- [ ] Visualisation panel begins showing a trace for output `a1`
- [ ] Output health shows `a1` as "running"

### - [ ] 5.2 Quantised eval

```lisp
(set-quant-phasor bar)

(a1 (usin bar))
```

Eval the `set-quant-phasor` first (immediate). Then change `a1` and use the quantised-eval binding.

**Verify:**
- [ ] The eval does NOT fire immediately — it queues
- [ ] On the next wrap of the quant phasor (`bar`), the queued eval executes
- [ ] You can hear/see the transition happen on the beat boundary (not immediately)
- [ ] Multiple quantised evals submitted before a wrap all execute in order on the wrap
- [ ] The eval flash is visually distinct from immediate eval (indicating "queued")

### - [ ] 5.3 Soft eval (WASM preview)

```lisp
(a1 (osc 220))
```

Use the soft-eval binding (check keybindings — typically a modifier variant).

**Verify:**
- [ ] A visually distinct flash (different from immediate eval) signals "preview"
- [ ] Visualisation updates to show the new expression
- [ ] Output health does NOT change to "running" for hardware (WASM-only preview)

### - [ ] 5.4 Error handling and diagnostics

```lisp
(a1 (nonexistent-function 42))
```

Eval this.

**Verify:**
- [ ] The music doesn't stop — previous outputs continue (LKG fallback)
- [ ] An inline diagnostic annotation appears at the error location
- [ ] Console shows the error message
- [ ] The diagnostic is human-readable (not jargon like "arity mismatch")
- [ ] Editing the text within the diagnostic range does NOT clear the diagnostic
- [ ] Re-evaluating successfully DOES clear the diagnostic

### - [ ] 5.5 Hole blocks eval

```lisp
(a1 (osc ($ freq :number)))
```

Attempt to eval.

**Verify:**
- [ ] Eval is rejected — no runtime submission
- [ ] Inline diagnostic appears at each unfilled hole: "fill this hole first"
- [ ] Other top-level forms without holes still eval normally on the same submission

### - [ ] 5.6 Output health states

Eval several outputs:

```lisp
(a1 (usin bar))
(a2 (osc 440))
(d1 (pulse bar))
```

Then eval an error on one:

```lisp
(a2 (broken))
```

**Verify:**
- [ ] `a1` and `d1` remain "running" — unaffected by `a2`'s error
- [ ] `a2` shows "error" or "fallback" state
- [ ] Re-evaluating `a2` with valid code restores it to "running"

### - [ ] 5.7 Inline result display

After a successful eval, observe the ephemeral result widget.

**Verify:**
- [ ] Result text appears adjacent to the evaluated range
- [ ] It auto-dismisses after ~3 seconds (configurable via `evalResults.autoDismissMs`)

</details>

---

<details>
<summary>

## - [ ] 6. Visualisation

</summary>

The visualisation panel shows time-series traces for active outputs. Time axis is centred on "now" — left half is recorded past, right half is projected future. WebGL rendered.

### - [ ] 6.1 Basic trace rendering

```lisp
(a1 (usin bar))
(a2 (slow 2 (osc 440)))
(d1 (pulse (fast 4 bar)))
```

Eval all three.

**Verify:**
- [ ] Visualisation panel shows three traces (two analogue, one digital)
- [ ] Analogue outputs render as smooth continuous lines
- [ ] Digital output renders as a step-mode binary trace
- [ ] The time axis has a centre marker at "now"
- [ ] Past values (left half) are recorded — they show what actually happened
- [ ] Future values (right half) are projected — visually distinct (lower alpha or dashed)

### - [ ] 6.2 Expression change discontinuity

With `a1` running, eval a new expression:

```lisp
(a1 (slow 4 (tri bar)))
```

**Verify:**
- [ ] Past buffer retains the old trace right up to the moment of change
- [ ] Future projection immediately shows the new expression
- [ ] A visible discontinuity at the changeover point (this is intentional — honest vis)

### - [ ] 6.3 Empty state

Clear all outputs (eval empty expressions or clear the document).

**Verify:**
- [ ] Visualisation shows a placeholder ("No expressions selected" or similar)
- [ ] CPU usage drops (no unnecessary rendering)

### - [ ] 6.4 Panel resize

Resize the browser window or panel.

**Verify:**
- [ ] Traces adapt to the new dimensions without glitches
- [ ] No loss of data or blank flashes during resize

</details>

---

<details>
<summary>

## - [ ] 7. Probes

</summary>

Probes are inline, time-following sample widgets attached to sub-expressions. They show a mini time-series trace adjacent to the marked range in the editor. Probes sample via WASM only.

### - [ ] 7.1 Insert and remove a probe

```lisp
(a1 (+ (usin bar) (slow 2 (osc 440))))
```

Eval this. Then place your cursor on `(usin bar)` and activate the probe keybinding.

**Verify:**
- [ ] A mini WebGL trace appears adjacent to `(usin bar)` in the editor
- [ ] The trace is live — it updates in real-time showing the sub-expression's value
- [ ] Toggling the probe keybinding again removes it

### - [ ] 7.2 Probe modes (raw vs contextual)

```lisp
(a1 (slow 4 (usin bar)))
```

Probe the inner `(usin bar)`.

**Verify:**
- [ ] In `raw` mode — shows the bare `(usin bar)` value (fast sine)
- [ ] In `contextual` mode — includes the `slow 4` wrapper, showing the time-stretched result
- [ ] Depth label shows `"raw"` or `"<depth>/<maxDepth>"`
- [ ] Left/right carets on the widget adjust depth

### - [ ] 7.3 Probe persistence

Insert a probe, then reload the page.

**Verify:**
- [ ] The probe reappears on reload at the same position
- [ ] If the text hasn't changed at that position, it resumes sampling
- [ ] If the text HAS changed, the probe enters "stale" state with a warning

</details>

---

<details>
<summary>

## - [ ] 8. Live-Edit Values

</summary>

Live-edit marks a literal value as runtime-controllable via an inline widget (knob/slider/toggle/picker). The runtime treats the marked value as an external input — knob turns don't recompile, they stream new values per UI tick.

### - [ ] 8.1 Mark a number as live-edit

```lisp
(a1 (osc 440))
```

Eval this. Focus on `440` and trigger `liveEdit.mark`.

**Verify:**
- [ ] The literal is wrapped: `(a1 (osc (live-edit 440 :id "xxxx" :min 20 :max 2000)))`
- [ ] An inline knob widget replaces the wrapper text (the source is hidden behind the widget)
- [ ] Turning the knob changes the oscillator frequency in real-time (no recompile)
- [ ] The value readout next to the knob updates as you turn

### - [ ] 8.2 Range inference

Mark different values in different contexts:

```lisp
(osc 0.5)     ;; → should infer frequency range (min 20, max 2000) because parent is `osc`
(slow 4 bar)  ;; focus on 4 → should infer time-division range (min 1, max 16)
(+ 0.3 0.7)   ;; focus on 0.3 → should infer unit range (0-1)
```

**Verify:**
- [ ] `osc` context: min=20, max=2000 (not unit range!)
- [ ] `slow` context: min=1, max=16 (integer multiplier range)
- [ ] Unit range: min=0, max=1 (value already in 0-1)

### - [ ] 8.3 Boolean toggle

```lisp
(if true (usin bar) (osc 440))
```

Focus on `true` and mark it.

**Verify:**
- [ ] A pill toggle widget appears: `[● on]` / `[off ●]`
- [ ] Clicking flips between `true`/`false`
- [ ] The output switches between the two branches in real-time

### - [ ] 8.4 Unmark

Focus on an existing live-edit widget and trigger `liveEdit.mark` again (it's a toggle).

**Verify:**
- [ ] The wrapper is stripped, original literal value restored
- [ ] The widget disappears
- [ ] An eval fires automatically to free the runtime slot

### - [ ] 8.5 Differs-from-seed indicator

Mark `440`, then turn the knob away from 440.

**Verify:**
- [ ] A small tick mark appears at the seed position on the knob's sweep
- [ ] The handle renders in a "modified" tone
- [ ] `liveEdit.resetToSeed` (or clicking the tick) snaps back to 440

### - [ ] 8.6 Widget states on reload

Mark a value, change it from seed, reload the page.

**Verify:**
- [ ] On reload, the widget appears in "uninitialised" state (⏳ glyph, faded)
- [ ] After the first eval, it transitions to `idle` with the persisted value restored
- [ ] The persisted value (not the seed) is what the runtime initialises to

### - [ ] 8.7 Vector marking

```lisp
(from-list [1 2 3 4] bar)
```

Focus on the vector `[1 2 3 4]` and trigger `liveEdit.mark`.

**Verify:**
- [ ] Enters vector-mark sub-mode: each element gets an underline decoration (solid = selected)
- [ ] Navigate between elements with left/right
- [ ] Toggle individual elements with the mark action
- [ ] Confirm (Enter / Start) wraps all selected elements as individual live-edits
- [ ] Cancel (Esc / Back) aborts without changes

### - [ ] 8.8 Live-edit panel

With one or more live-edits active, open the live-edit panel (toolbar button or keybinding).

**Verify:**
- [ ] Panel docks to the right side, showing a card per active live-edit
- [ ] Each card has: name header (editable on click), a larger knob/control, current value readout, MIDI learn icon
- [ ] Manipulating the panel knob has the same effect as manipulating the inline widget
- [ ] Editing the `:name` on a card updates the label (persisted across reload)
- [ ] Panel is collapsible/closeable without destroying the live-edits

### - [ ] 8.9 MIDI learn

With the live-edit panel open and a MIDI controller connected (Web MIDI API):

**Verify:**
- [ ] Click the MIDI learn icon (◉ LRN) on a card — card enters "listening" state (pulsing accent)
- [ ] Inline widget also shows the pulsing "listening" state
- [ ] Turn a MIDI knob — binding completes, CC number displayed on the card
- [ ] The MIDI knob now streams values to the live-edit slot in real-time
- [ ] MIDI binding persists across page reloads
- [ ] Re-learn: clicking the binding label allows rebinding to a different CC

### - [ ] 8.10 Copy-paste duplicate ID handling

Mark a value as live-edit, then copy-paste the enclosing form:

```lisp
(a1 (osc (live-edit 440 :id "abcd" :min 20 :max 2000)))
```

Select and copy this form, paste it below.

**Verify:**
- [ ] The pasted copy has a NEW `:id` (not `"abcd"`) — auto-rewritten on paste
- [ ] Both live-edits work independently (different slots, different values)
- [ ] The pasted widget initialises to `<seed>` (440), not the original's current value

</details>

---

<details>
<summary>

## - [ ] 9. Atom Manipulation

</summary>

Atom manipulation edits leaf values in-place without leaving structural mode. LB/RB adjust numbers, cycle symbols through groups, and toggle booleans. L3 flips polarity. Right stick scrubs floats (joystick editing).

### - [ ] 9.1 Number adjustment (LB/RB tap)

```lisp
(a1 (osc 440))
```

Focus on `440` (integer).

**Verify:**
- [ ] RB tap: increments by 1 → `441`
- [ ] LB tap: decrements by 1 → `439`
- [ ] Holding LB/RB triggers auto-repeat (continuous adjustment)
- [ ] The cursor stays on the number throughout

Now try a float:

```lisp
(a1 (* 0.50 (usin bar)))
```

Focus on `0.50`.

**Verify:**
- [ ] RB tap: `0.60` (step = 0.1 based on 1 decimal place of precision)
- [ ] Formatting preserved: trailing zero maintained (`0.60`, not `0.6`)

### - [ ] 9.2 Symbol cycling

```lisp
(a1 (usin bar))
```

Focus on `usin`.

**Verify:**
- [ ] RB tap: cycles to next in the `waveshapes` group (`ucos`)
- [ ] LB tap: cycles to previous (`cos`)
- [ ] A cycling widget appears showing neighbours: `‹ cos 「usin」 ucos sqr ›`
- [ ] Widget dismisses after ~800ms of no input
- [ ] The group wraps around (after last member, returns to first)

Now try:

```lisp
(a1 (+ (usin bar) (osc 440)))
```

Focus on `+`.

**Verify:**
- [ ] Cycles through `arithmetic` group: `+` → `-` → `*` → `/` → `%` → `+`

### - [ ] 9.3 Boolean toggle

```lisp
(if true (usin bar) 0)
```

Focus on `true`.

**Verify:**
- [ ] Either LB or RB flips to `false`
- [ ] Another tap flips back to `true`

### - [ ] 9.4 Polarity flip (L3 / Left Stick Press)

```lisp
(a1 (* 0.5 (usin bar)))
```

Focus on `0.5`.

**Verify:**
- [ ] L3 press: `0.5` → `-0.5`
- [ ] L3 again: `-0.5` → `0.5`
- [ ] On zero (`0` or `0.0`): no-op flash
- [ ] On a non-number node: L3 retains its default binding (no polarity flip)
- [ ] Formatting preserved: `-0.50` flips to `0.50`

### - [ ] 9.5 Joystick float editing

```lisp
(a1 (* 0.50 (usin bar)))
```

Focus on `0.50` (must be a float — has decimal point).

**Verify:**
- [ ] Right stick X-axis deflection adjusts the value (velocity mode — rate proportional to deflection)
- [ ] Centre/deadzone = value holds steady
- [ ] Value snaps to step quantisation (clean numbers in source text)
- [ ] Moving cursor off the number exits joystick-edit mode (sticks return to default)
- [ ] On an integer literal: joystick float editing does NOT activate (LB/RB stepping suffices)

### - [ ] 9.6 Interaction with modifier layers

Focus on a leaf atom.

**Verify:**
- [ ] Tapping LB briefly: atom adjust fires
- [ ] Holding LB: enters slurp/barf layer (atom adjust doesn't fire on hold)
- [ ] When cursor is on a compound (not a leaf): LB/RB tap has no atom-adjust — acts as modifier only

</details>

---

<details>
<summary>

## - [ ] 10. Radial Menu

</summary>

The radial menu is a gamepad-driven content picker — a centre-screen double-ring overlay for choosing functions, symbols, and literals to insert into the document. Left ring = categories, right ring = items. Sticks navigate the rings.

### - [ ] 10.1 Open and close

Ensure you're in structural mode with a cursor on a node.

**Verify:**
- [ ] Tap Y (gamepad): menu opens with two rings centred on screen
- [ ] Editor is dimmed behind the menu but still visible
- [ ] B (gamepad) or Escape: menu closes without applying anything
- [ ] If cursor was on a hole, the menu may auto-open scoped to that hole's type

### - [ ] 10.2 Ring navigation

With the menu open:

**Verify:**
- [ ] Left stick deflection: highlights segments in the left ring (categories)
- [ ] Right stick deflection: highlights segments in the right ring (items)
- [ ] LB/RB: cycles tabs (changes the category set shown in the left ring)
- [ ] Selecting a category in the left ring updates the right ring's items

### - [ ] 10.3 Apply verbs

Navigate to an item (e.g. `osc` function) in the right ring.

**Verify:**
- [ ] A press (or equivalent commit): applies the default verb (Insert at cursor position)
- [ ] The menu closes after applying
- [ ] The inserted content appears in the document as a proper structural edit
- [ ] If the inserted form has typed holes, auto-chain kicks in (menu re-opens scoped to the first hole's type)

### - [ ] 10.4 Auto-chain (hole filling)

Select a function with multiple args (e.g. `slow` which takes `($ rate :number)` and `($ body :expr)`):

**Verify:**
- [ ] After inserting `(slow [num·rate] [exp·body])`, cursor lands on first hole
- [ ] Menu auto-opens scoped to `:number` type (numpad sub-mode or number items)
- [ ] Fill the number hole → cursor advances to next hole (`[exp·body]`)
- [ ] `:expr` holes do NOT auto-open the menu (user taps Y when ready)

### - [ ] 10.5 Replace and WrapWith verbs

Focus on an existing node (e.g. `440`), open the menu:

**Verify:**
- [ ] Replace verb: the selected item replaces the focused node
- [ ] WrapWith verb: the focused node becomes an argument of the selected function

</details>

---

<details>
<summary>

## - [ ] 11. Main Menu (L3+R3)

</summary>

The main menu is a system/pause menu opened by pressing both sticks simultaneously (L3+R3 chord). It's for non-performance actions: settings, save/restore, help.

### - [ ] 11.1 Open and close

**Verify:**
- [ ] L3+R3 chord (press both sticks): full-screen menu appears
- [ ] Editor is paused (no eval, no live-edit streaming)
- [ ] The runtime continues playing on WASM (music doesn't stop)
- [ ] B / Escape / L3+R3 again: closes the menu
- [ ] On close, editor state is fully restored (cursor, mode, layers)

### - [ ] 11.2 Navigation

With the menu open:

**Verify:**
- [ ] D-pad Up/Down: moves between menu items
- [ ] A / Enter: selects the focused item
- [ ] Items with a submenu indicator: selecting opens a child list
- [ ] B / Back: goes back one submenu level (or closes at top level)

### - [ ] 11.3 Menu items

**Verify these are present and functional:**
- [ ] Resume — closes the menu
- [ ] Practice Zone — enters Zen mode
- [ ] Save (submenu) — save to slots
- [ ] Restore (submenu) — restore from slots
- [ ] Settings (submenu) — settings categories
- [ ] Help (submenu) — keybindings reference, language reference
- [ ] Connection — shows WASM/hardware status
- [ ] Transport (submenu) — play/pause/stop/BPM

### - [ ] 11.4 Keyboard fallback

Without a gamepad, press Escape when no sub-mode is active:

**Verify:**
- [ ] First Escape cancels any active sub-mode (radial menu, etc.)
- [ ] Second Escape (with nothing to cancel) opens the main menu

</details>

---

<details>
<summary>

## - [ ] 12. Gamepad Pipeline

</summary>

The gamepad pipeline is a three-stage system: hardware polling → gesture recognition → action resolution. It supports taps, holds, held-repeat, double-taps, chords, and stick flicks.

### - [ ] 12.1 Basic gestures

Connect a gamepad (or use `?virtualGamepad=true`).

**Verify:**
- [ ] Tap A: performs the primary action (confirm / apply in context)
- [ ] Tap B: performs the secondary action (cancel / back in context)
- [ ] D-pad: spatial navigation (moves cursor through the document)
- [ ] Left stick: same as D-pad for navigation (or menu ring when menu is open)
- [ ] Disconnect gamepad: app doesn't crash, continues working

### - [ ] 12.2 Hold and held-repeat

**Verify:**
- [ ] Hold LB: enters slurp/barf layer (different actions available while held)
- [ ] Release LB: exits the layer
- [ ] Hold D-pad direction: auto-repeats navigation (held gesture with counter)

### - [ ] 12.3 Dual-binding (eager-with-undo)

LB is bound as both tap (atom adjust) and hold-modifier (slurp/barf layer):

**Verify:**
- [ ] Quick tap LB: atom adjust fires immediately (eager dispatch)
- [ ] If you start holding instead, the tap action is undone and the hold layer activates
- [ ] This transition is seamless — no visual jank or double-action

### - [ ] 12.4 Chord gestures

**Verify:**
- [ ] L3+R3 simultaneously: opens main menu (chord gesture)
- [ ] Individual L3 or R3: performs their own single-button action (polarity flip, etc.)
- [ ] The chord only fires when BOTH are pressed within the chord timing window

### - [ ] 12.5 Layer stack

**Verify:**
- [ ] Default layer: navigation, atom adjust, Y for menu
- [ ] LB held: slurp/barf/structural-mutation layer
- [ ] RB held: probe/visualisation layer
- [ ] Radial menu open: menu navigation layer (overrides default)
- [ ] Main menu open: menu layer (overrides everything)
- [ ] Layers stack properly and pop cleanly on release/close

</details>

---

<details>
<summary>

## - [ ] 13. Zen Mode

</summary>

Zen mode is a full-screen practice environment for structural editing. It presents exercises with a starting state, a target state, and validates your actions. Accessible via `#/zen` or the main menu.

### - [ ] 13.1 Entry and exit

**Verify:**
- [ ] Navigate to `#/zen` — zen mode loads
- [ ] From main menu: select "Practice Zone" — enters zen mode
- [ ] Exit: press Escape / Back from the grid, or navigate away via URL
- [ ] On exit: main editor state is fully restored (no zen state leaks)

### - [ ] 13.2 Grid home screen

**Verify:**
- [ ] Grid shows rows (categories): Navigation, Slurp & Barf, Raise & Splice, Wrap, Transpose, Combos
- [ ] Each cell shows a tiny code preview and operation label
- [ ] All exercises are unlocked (nothing is gated behind progress)
- [ ] "Continue" button drops you into the next incomplete exercise
- [ ] Grid is navigable by D-pad + A (gamepad) or arrows + Enter (keyboard)

### - [ ] 13.3 Exercise runner

Select any exercise.

**Verify:**
- [ ] Editor shows the starting code with cursor at the marked position
- [ ] Prompt bar shows what operation to perform
- [ ] Performing the correct operation → success feedback (the target is achieved)
- [ ] Input hints adapt to your device (gamepad buttons vs keyboard shortcuts)
- [ ] Progress is persisted (completed exercises show as filled on the grid)

### - [ ] 13.4 Paradigm selection

**Verify:**
- [ ] A dropdown allows selecting different gamepad paradigms
- [ ] Changing paradigm updates button hints shown in exercises
- [ ] This doesn't affect your persisted settings (zen uses a temporary paradigm)

</details>

---

<details>
<summary>

## - [ ] 14. Settings & Themes

</summary>

Settings are a typed, normalised, persistent record. Theme switching is hot (no reload). The settings panel is accessible from the main menu or via keyboard shortcut.

### - [ ] 14.1 Settings persistence

Open settings, change a value (e.g. `visualisation.windowDuration`), close settings, reload.

**Verify:**
- [ ] The changed value persists across reloads
- [ ] The settings panel subdivides into tabs: General, Themes, Keybindings
- [ ] General has sub-sections: Personal, Editor, Console, Eval Results, etc.

### - [ ] 14.2 Theme switching

Open settings → Themes tab. Switch between themes.

**Verify:**
- [ ] Theme applies instantly (no reload, no flash of unstyled content)
- [ ] Editor syntax highlighting changes
- [ ] Chrome/toolbar colours change
- [ ] Visualisation palette changes (dark theme → dark palette; light → light)
- [ ] All three surfaces stay in sync (no surface shows a stale theme)
- [ ] No loss of editor state, transport state, console history, or vis traces

### - [ ] 14.3 Settings normalisation

Open browser devtools and corrupt the settings in localStorage:

```js
localStorage.setItem('uSEQ-Perform-User-Settings', '{"editor":{"theme":"NONEXISTENT"},"garbage":true}')
```

Reload.

**Verify:**
- [ ] App loads without crashing
- [ ] Unknown fields are dropped, invalid values reset to defaults
- [ ] Console shows a warning about the corruption (not an error that blocks the app)

</details>

---

<details>
<summary>

## - [ ] 15. Console

</summary>

The console panel shows a chronological message log with types (log, warn, error, wasm). Messages animate in. Auto-scroll behaviour tracks the user's scroll position.

### - [ ] 15.1 Message display

Eval valid and invalid code:

```lisp
(a1 (usin bar))        ;; should produce a result echo
(a2 (broken-fn 42))   ;; should produce an error
```

**Verify:**
- [ ] Successful eval produces a result echo in the console (type: wasm)
- [ ] Failed eval produces an error message (type: error)
- [ ] Each entry has a timestamp and type badge
- [ ] New entries animate in (slide by default)

### - [ ] 15.2 Auto-scroll

Scroll the console up (away from the bottom). Then trigger more eval messages.

**Verify:**
- [ ] Auto-scroll is suspended (new messages don't pull you to the bottom)
- [ ] An "unread" indicator appears
- [ ] Scrolling back to the bottom re-enables auto-scroll

### - [ ] 15.3 Clear

Use the clear action.

**Verify:**
- [ ] All messages are wiped
- [ ] New messages after clear still appear normally

</details>

---

<details>
<summary>

## - [ ] 16. Persistence & Autosave

</summary>

The app autosaves editor content and settings to localStorage. Code is saved periodically; settings are saved on every mutation.

### - [ ] 16.1 Editor autosave

Type some code, wait a few seconds, reload.

**Verify:**
- [ ] Your code is restored on reload (from `uSEQ-Perform-User-Code` or `editorContent`)
- [ ] No data loss on normal reload

### - [ ] 16.2 Corrupt persistence recovery

Manually corrupt localStorage:

```js
localStorage.setItem('uSEQ-Perform-User-Code', '{{{INVALID JSON')
```

Reload.

**Verify:**
- [ ] App loads without crashing
- [ ] Editor shows empty or default content (not a garbled string)
- [ ] Console shows a warning about the parse error

### - [ ] 16.3 `?nosave` round-trip

1. Save some code normally
2. Open with `?nosave`, make edits
3. Reload without `?nosave`

**Verify:**
- [ ] The edits made during `?nosave` session are gone
- [ ] The pre-nosave state is intact

</details>

---

<details>
<summary>

## - [ ] 17. URL Parameters

</summary>

URL parameters are the highest-precedence configuration source. They override persisted settings and product defaults.

### - [ ] 17.1 `?default`

```
URL: https://useq-perform.localhost/?default
```

**Verify:**
- [ ] Editor shows the hardcoded default starting code (ignores persisted code)

### - [ ] 17.2 `?nosave`

Covered in §16.3 above.

### - [ ] 17.3 `?disableWebSerial=true`

```
URL: https://useq-perform.localhost/?disableWebSerial=true
```

**Verify:**
- [ ] App forces browser-local WASM mode regardless of browser capability
- [ ] No Web Serial connection prompts appear

### - [ ] 17.4 `?virtualGamepad=true`

```
URL: https://useq-perform.localhost/?virtualGamepad=true
```

**Verify:**
- [ ] Virtual gamepad overlay appears
- [ ] Interacting with virtual buttons produces gamepad events

</details>

---

<details>
<summary>

## - [ ] 18. Transport Controls

</summary>

Transport controls drive the runtime clock: play, pause, stop, rewind. These fan out to both runtimes (WASM and hardware when connected). The transport state is visible in the toolbar indicator.

### - [ ] 18.1 Play / Pause / Stop

With some code evaluated (e.g. `(a1 (usin bar))`):

**Verify:**
- [ ] Play: WASM time advances, vis traces animate, output values change over time
- [ ] Pause: time freezes, vis traces stop advancing, output values hold at their current position
- [ ] Stop: time resets to zero, vis traces clear future and past resets, outputs go to initial state
- [ ] Transport indicator in the toolbar reflects the current state

### - [ ] 18.2 Rewind

With the transport playing and some history accumulated in the vis panel:

**Verify:**
- [ ] Rewind: transport time snaps back to zero
- [ ] Vis past buffer clears (we're at the beginning — no history yet)
- [ ] Outputs restart from their initial state (phasors reset, oscillators restart from phase 0)

### - [ ] 18.3 BPM

```lisp
(bpm 120)
(a1 (pulse bar))
```

Eval, then change BPM:

```lisp
(bpm 60)
```

**Verify:**
- [ ] The pulse rate halves (120 BPM → 60 BPM = half speed)
- [ ] Vis traces reflect the new tempo immediately
- [ ] Transport-derived phasors (`bar`, `beat`, etc.) respect the new BPM

</details>

---

<details>
<summary>

## - [ ] 19. From-List Highlights

</summary>

When a `from-list` (or `seq`/`flatseq`) expression is evaluated, the editor highlights which list element is currently active based on the indexing phasor. This gives immediate visual feedback about sequence position.

### - [ ] 19.1 Basic highlight

```lisp
(a1 (from-list [0.1 0.3 0.5 0.7 0.9] bar))
```

Eval this.

**Verify:**
- [ ] As time advances, individual elements in the vector `[0.1 0.3 0.5 0.7 0.9]` highlight in sequence
- [ ] The highlight moves at the rate of `bar` (one full cycle per bar)
- [ ] Only one element is highlighted at a time
- [ ] The highlight is inline in the editor (not in the vis panel)

### - [ ] 19.2 Nested from-list

```lisp
(a1 (from-list [0.1 0.5 0.9] (slow 2 bar)))
```

**Verify:**
- [ ] Highlight cycles at the `slow 2 bar` rate (half speed)
- [ ] Changing the phasor argument and re-evaluating updates the highlight rate

### - [ ] 19.3 Independence from probes

Remove any probes on the `from-list` expression.

**Verify:**
- [ ] From-list highlights continue to work without an active probe on the expression
- [ ] Highlights are a separate feature from probes (probes show value traces; highlights show index position)

</details>

---

<details>
<summary>

## - [ ] 20. Help Panel & Onboarding

</summary>

The help panel provides in-app documentation (guide, language reference, snippets). The onboarding banner appears for first-time users and is dismissible.

### - [ ] 20.1 Onboarding banner

Open with `?nosave&default` to simulate a first-time user (or clear localStorage first):

```
URL: https://useq-perform.localhost/?nosave&default
```

**Verify:**
- [ ] An onboarding banner is visible (welcoming the user, suggesting next steps)
- [ ] The banner is dismissible (click X or a "got it" button)
- [ ] After dismissal, the banner does not reappear on reload (persisted flag — unless `?nosave`)

### - [ ] 20.2 Help panel tabs

Open the help panel (from toolbar, main menu, or keybinding).

**Verify:**
- [ ] Guide tab: shows a structured walkthrough / user guide
- [ ] Reference tab: language reference with function documentation
- [ ] Snippets tab: code snippets the user can insert
- [ ] Starred items persist across reloads
- [ ] Clicking a snippet inserts it into the editor (or copies to clipboard)

### - [ ] 20.3 Connection status indicator

With WASM active (no hardware):

**Verify:**
- [ ] A visible indicator somewhere (toolbar or status area) shows the current runtime mode
- [ ] WASM-only mode is visually distinct from "no runtime" and from "both"
- [ ] The indicator is not just a boolean "connected/disconnected" — it distinguishes the mode

</details>

---

---

# Hardware-Only Testing

> The following features require a physical uSEQ module connected via USB/Serial.
> Skip these sections when testing on the plane.

---

<details>
<summary>

## - [ ] H1. Hardware Connection & `both` Mode

</summary>

Connecting hardware while in WASM mode should seamlessly upgrade to `both` mode. Hardware is authoritative for outputs; WASM complements with local sampling and visualisation.

### - [ ] H1.1 Connect

**Verify:**
- [ ] Connection indicator changes from WASM-only to `both` (visually distinct)
- [ ] Prompt appears: "Hardware connected. Send current program to device?"
- [ ] If confirmed, current WASM state is synced to hardware
- [ ] No loss of editor state, console history, or vis traces

### - [ ] H1.2 Disconnect

Unplug the USB cable while in `both` mode.

**Verify:**
- [ ] Falls back to `wasm` mode seamlessly
- [ ] Visualisation continues (from WASM sampling)
- [ ] Editor continues working
- [ ] Connection indicator updates

### - [ ] H1.3 Auto-reconnect

With `runtime.autoReconnect` enabled (default), reload the page with hardware plugged in.

**Verify:**
- [ ] App auto-reconnects to the previously saved port
- [ ] No manual "Connect" action needed

</details>

---

<details>
<summary>

## - [ ] H2. Hardware Bindings

</summary>

Hardware bindings associate ModuLisp expressions with physical button events (press, release, hold lifecycle). These are source-level wrapper forms that travel with the patch.

### - [ ] H2.1 `on-press` / `on-release`

```lisp
(on-press :sw1
  (a1 (osc 880)))

(on-release :sw1
  (a1 (osc 440)))
```

Eval both. Press and release the button on the module.

**Verify:**
- [ ] Pressing sw1: `a1` switches to 880 Hz
- [ ] Releasing sw1: `a1` switches back to 440 Hz
- [ ] Inline chip widget shows the binding is active (status dot)

### - [ ] H2.2 `on-button` (lifecycle handler)

```lisp
(on-button :sw1
  (lambda (phase ms)
    (if (= phase :hold)
      (a1 (osc (+ 440 (* ms 0.1))))
      (a1 (osc 440)))))
```

**Verify:**
- [ ] Press: `phase` = `:press`, ms = 0
- [ ] Hold: continuous calls with increasing `ms`
- [ ] Release: `phase` = `:release`, ms = total hold duration
- [ ] Sound ramps up while holding, returns to 440 on release

### - [ ] H2.3 `on-toggle`

```lisp
(on-toggle :sw2
  (lambda (state)
    (if state
      (a1 (usin bar))
      (a1 (osc 440)))))
```

**Verify:**
- [ ] Toggle on: `a1` switches to `usin`
- [ ] Toggle off: `a1` switches to `osc`

### - [ ] H2.4 Test-fire (without hardware)

Focus on a hardware binding chip widget. Use the test-fire UX.

**Verify:**
- [ ] Test-fire simulates the button press locally (WASM eval)
- [ ] No hardware required for test-fire — works in WASM-only mode

</details>

---

<details>
<summary>

## - [ ] H3. Calibration

</summary>

CV 1V/oct calibration is a full-screen takeover flow for tuning analog outputs against an external tuner. Per-octave offset saving with carry-forward.

### - [ ] H3.1 Entry

Open calibration (from settings or `?calibrate=1` when implemented).

**Verify:**
- [ ] Full-screen calibration UI appears
- [ ] Per-output picker lets you select which output to calibrate
- [ ] Step-by-step wizard walks through octaves
- [ ] ±50¢ slider for fine adjustment at each octave

### - [ ] H3.2 Save and abort

**Verify:**
- [ ] Saving persists calibration data to the module (flash persistence)
- [ ] Aborting restores previous state without changes
- [ ] Error states (e.g. lost connection mid-calibration) are handled gracefully

</details>

---

<details>
<summary>

## - [ ] H4. Hardware-Streamed Visualisation

</summary>

In `hardware`-only mode (WASM disabled), visualisation uses hardware-streamed serial data instead of WASM sampling.

### - [ ] H4.1 Serial visualisation

Disable WASM in settings, connect hardware.

**Verify:**
- [ ] Visualisation panel still renders traces (from serial stream data)
- [ ] Probes show "WASM disabled" state (they require WASM)
- [ ] Performance is smooth at the documented channel count

</details>
