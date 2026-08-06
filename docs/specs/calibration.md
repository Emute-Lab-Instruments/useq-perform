---
stability: aspirational
layer: behavioural
---

# CV 1V/oct Calibration Takeover

> Spec: editor-side machinery for the CV-output 1V/oct calibration flow — a full-screen takeover that walks the user through tuning each analog output against an external tuner, with per-octave save and flash persistence. Counterpart to [MAIN.md](MAIN.md).
> See also [overlays.md](overlays.md) (modal stack, focus rules), [transport.md](transport.md) (the takeover supersedes normal transport ownership of outputs), [code-evaluation.md](code-evaluation.md) (the takeover suspends eval-driven output behaviour).
> Wire-protocol counterpart: see the `calibrate-*` message family in [../../src-useq/docs/specs/wire-protocol.md](../../src-useq/docs/specs/wire-protocol.md) §5.11–§5.16.
> Current boundary: the editor flow is aspirational and the pinned firmware
> does not yet implement calibration takeover/storage. JSON-v1 reserves and
> validates the message family but returns `success:false`; see §1.6.

### Source files

- `src/effects/calibrationSequencer.ts` — calibration state machine, wire-protocol command dispatch, per-step logic
- `src/ui/calibration/CalibrationTakeover.tsx` — full-screen takeover overlay (layout, slider, progress ribbon, action buttons)
- `src/ui/calibration/CalibrationPicker.tsx` — pre-flight output picker modal (output list, status, pick affordance)
- `src/ui/calibration/CalibrationProgress.tsx` — progress ribbon (step dots, save/skip/pending states)
- `src/ui/calibration/CalibrationSlider.tsx` — continuous cents-offset slider (snap-to-zero, keyboard/mouse/gamepad drivers)
- `src/ui/calibration/CalibrationCompleteBanner.tsx` — completion banner ("Saved to flash", chain-to-next-output)
- `src/ui/adapters/calibration.tsx` — imperative mount/show API for calibration components

---

## 1. Frame

1.1 **CV 1V/oct calibration** is the process of trimming each analog output's voltage curve so that integer-volt values produced by the patch correspond to whole-octave musical pitches in the user's external setup. Cheap DACs and component tolerance mean uncalibrated outputs drift; calibration produces a per-output offset/gain map stored in flash.

1.2 The flow is **firmware-driven** at the wire level (the firmware drives the output to a target voltage and accepts adjustment deltas; the editor is a UI shell). This spec covers only the editor-side UX. The wire-protocol message set (`calibrate-begin`, `calibrate-set-target`, `calibrate-adjust`, `calibrate-save-point`, `calibrate-end`, plus rejection envelopes) lives in the firmware spec.

1.3 The product use case is the performer setting up the module before a gig — a focused, deliberate task, not something they'll do mid-performance. The takeover should *feel* deliberate: full-screen, undistracted, big readable values, no other UI competing for attention. This is uSEQ's "headline hardware feature" demo moment.

1.4 The user calibrates **one output at a time**. Per-output, the flow walks five fixed octave points: `0V, 1V, 2V, 3V, 4V`. After completing an output, the user is offered the chain to the next. (Multi-output batch mode is deferred — §10.)

1.5 The user reads voltage from an **external tuner** (or oscilloscope, or another module). The editor never measures the output itself; it only commands the firmware to drive a target and applies adjustment deltas the user dictates.

1.6 **Current implementation boundary.** The editor state machine and UI shell
exist, but the pinned firmware has no `calibrate-*` handlers or flash-backed
takeover state. The canonical JSON-v1 schema marks these routes unsupported so
the device rejects them explicitly instead of acknowledging them through the
eval fallback. This clause is removed when the firmware backend and physical
calibration validation land.

---

## 2. Entry and Pre-Flight

2.1 **Entry points.**
- **Settings panel** → Hardware → "Calibrate CV Outputs…" button. Primary path.
- **Toolbar action** `calibration.begin` (registered in [keybindings.md](keybindings.md)) — opens the picker.
- **URL param** `?calibrate=1` — opens the picker on next boot once a hardware connection is established. Useful for handing the module to a tech.

2.2 **Pre-flight picker** (see `src/ui/calibration/CalibrationPicker.tsx`). A modal lists every analog output the connected variant exposes (typically `a1`–`a4`). Each row shows the output id, its current calibration status (`uncalibrated` / `calibrated <date>` / `partial`), and a pick affordance. A short helper paragraph reminds the user:

```
Calibrate CV Outputs

Plug an external tuner (or oscilloscope) into the output you want
to calibrate. The module will play 0V – 4V in sequence; you'll
adjust each step until your tuner reads C0, C1, C2, C3, C4.

Other outputs will be frozen during calibration.

  ◯ a1   uncalibrated         [Calibrate]
  ● a2   calibrated 2026-04-30 [Re-calibrate]
  ◯ a3   partial               [Resume / Restart]
  ◯ a4   uncalibrated          [Calibrate]

  [Cancel]
```

2.3 **Partial-calibration recovery.** If a previous session was aborted with the "Keep going" path or interrupted by disconnect, the affected output shows `partial`. Picking it offers `Resume` (continue from the next un-saved octave) or `Restart` (discard partial, start at 0V). This state is held in flash by the firmware; the editor reads it via a status field on the picker open.

2.4 **Pick → takeover.** Selecting an output:
1. Sends `calibrate-begin { output: "<id>" }`.
2. Awaits firmware ack. On rejection (e.g. takeover already active for a different output, or output not exposed by this variant), surfaces the rejection in the picker as an inline error and stays on the picker (§7.1).
3. On success, replaces the picker with the full-screen takeover overlay (§3).

The firmware is responsible for freezing all other outputs at their current LKG values during the takeover; the editor does not need to do anything beyond the wire-level command.

---

## 3. Takeover Overlay

3.1 **Full-screen overlay** (see `src/ui/calibration/CalibrationTakeover.tsx`). Calibration occupies the entire viewport. The editor, panels, console, and toolbar fade to ~30% opacity and become non-interactive (CSS `pointer-events: none`; no keyboard shortcuts route to the editor). The overlay sits at the top of the [overlay stack](overlays.md) and absorbs all input until dismissed.

3.2 **Layout.** Single focal column, generous negative space, large readable type. Reading top to bottom:

```
                    a1
                  1.000 V
                ──────────
                  −0.7 cents

           [‒‒‒‒‒‒█‒‒‒‒‒‒]   ±50 cents
                   ↑

   Step 2 of 5    ● ● ○ ○ ○

           [Save & next →]
              [ Skip ]
              [ Abort ]

  Move your tuner to the output. Adjust until
  the reading is exact. Then press Save.
```

- **Output id**, large (e.g. `a1`).
- **Target voltage** as the dominant numeric (e.g. `1.000 V`), monospace, large.
- **Current offset** in cents below it, signed (e.g. `−0.7 cents` or `+2.4 cents`). Updates live as the user drags.
- **Adjust slider** (§4).
- **Progress ribbon**: `Step N of 5` plus dots `● ● ○ ○ ○` showing saved (`●`) vs pending (`○`).
- **Action buttons**: `Save & next` (primary), `Skip`, `Abort`. The first is the default focus / Enter / Start target.
- **Helper text** at the bottom; can be muted by a setting after the user knows the flow.

3.3 **No music plays through the editor during takeover.** Visualisation continues to render the (frozen) output values for diagnostic purposes if the user wants a glance at the dimmed editor; but the takeover itself is the sole interaction surface.

3.4 **Keyboard focus and gamepad target.** The takeover is the gamepad target while open. The slider handle is the default-focused element so arrow keys / gamepad axis drive it immediately on entry.

---

## 4. Adjust Surface

4.1 **Continuous slider in cents** is the primary adjust mechanism (see `src/ui/calibration/CalibrationSlider.tsx`).

- Slider extent: **±50 cents** around the target. (50 cents = quarter-tone; outside this range the user almost certainly has a hardware issue, not a calibration issue.)
- Slider centre = 0 cents = the firmware's last-applied offset for this point. Each drag emits a `calibrate-adjust { delta: <cents-since-last-emit>, unit: "cents" }` to the firmware; the firmware applies the delta and the editor's local offset readout reflects the new total.
- **Snap to zero** when the handle crosses centre with a small tolerance (~0.3 cents) — a soft detent helps the user find "no offset."

4.2 **Companion drivers** for the same logical adjust action (all unified — every gesture below is a delta on the same offset):
- **Mouse drag** on the slider handle (primary).
- **Mouse click** on the track at a position (jump-to-position; emits the cumulative delta).
- **Mouse scroll** while pointer is over the slider: ±1 cent per notch; Shift+scroll = ±0.1 cent.
- **Keyboard arrows** while slider is focused: `←/→` = ±1 cent, `Shift+←/→` = ±0.1 cent, `Ctrl+←/→` = ±10 cents.
- **Gamepad right-stick X**: continuous analog drift; deadband per the global gamepad config; speed scales with stick deflection (slow tweak vs fast slew).

4.3 **Carry-forward starting offset.** When advancing to the next octave (§5), the slider's starting position is **the offset committed for the previous octave**, not zero. Rationale: most output drift is roughly linear, so the previous octave's offset is the best initial guess for the next. The user can still drag to centre if they want to start fresh.

4.4 **No live tuner readback.** The editor does not measure the output. The cents value displayed is the *offset the user has dialled in*, not a measurement. This is documented inline in the helper text on first entry.

4.5 **Accumulated delta safety.** The wire protocol is delta-based; the editor maintains a local mirror of the cumulative offset for display. If the firmware's response indicates a mismatch (e.g. clamped to a hardware limit), the editor reads the firmware's authoritative value from the response and snaps the slider to match (§7.2).

---

## 5. Save, Advance, and Complete

5.1 **Save & next** (Enter / Start / clicking the primary button) (see `src/effects/calibrationSequencer.ts`):
1. Sends `calibrate-save-point { octave: <0..4> }` to the firmware.
2. The current step's value display flashes green with a `✓` for ~400 ms (§5.2).
3. The progress ribbon's current dot fills (`○ → ●`).
4. The flow advances to the next octave: `calibrate-set-target { value: <next-V> }` is sent; the slider resets to the carry-forward starting offset (§4.3).
5. The display updates to the new target voltage and step number.

If the firmware rejects the save (§7), the flow stays on the current step and surfaces the error (§7.2). The progress dot does not fill until ack arrives.

5.2 **Per-step success animation.** Brief (~400 ms) inline checkmark next to the step's voltage; the focal column does not relocate or jump. The user's eye stays where it is.

5.3 **Skip.** Pressing Skip on the current step:
1. Sends no save-point to the firmware (the firmware retains whatever calibration value was already in flash for this octave, or interpolates if it has a mechanism for that — firmware decides).
2. Advances to the next octave with a small toast: `Skipped octave 2V — kept prior calibration.`
3. The progress dot for the skipped step shows a distinct glyph (`◐`) to differentiate from saved (`●`) and pending (`○`).

Skip is for the case where a particular octave is, say, outside the user's tuner range or the user trusts the existing calibration for that point.

5.4 **Last-octave completion** (see `src/ui/calibration/CalibrationCompleteBanner.tsx`). After saving the 5th (4V) point:
1. Final `calibrate-end { commit: true }` sent.
2. A bottom-banner success state replaces the action buttons:

```
   ┌─ Saved to flash ✓ ──────────────────┐
   │  a1 calibration complete            │
   │                                      │
   │  Calibrate next output?              │
   │  [a2]  [a3]  [a4]  [Done]            │
   └──────────────────────────────────────┘
```

3. Picking `[a2]` etc. starts a fresh takeover for that output (sends a new `calibrate-begin`); picking `[Done]` exits to the editor (overlay dismissed; editor returns to interactive).

5.5 **No partial completion banner.** The "Saved to flash" banner appears only on full completion of an output. Per-step ack is the inline checkmark + ribbon dot fill (§5.1) — no toast per step.

---

## 6. Abort

6.1 **Abort triggers.** `Abort` button, `Esc` key, gamepad `Back`. All three open the same confirm prompt.

6.2 **Confirm-then-revert.** A small inline confirm appears in place of the action buttons (no nested modal):

```
   Discard partial calibration of a1?
   You've saved 2 of 5 points.

   [ Discard ]    [ Keep going ]
```

- **Discard** sends `calibrate-end { commit: false }`. The firmware reverts the output's calibration to its **pre-takeover state** (the calibration that was in flash before `calibrate-begin`). The takeover overlay dismisses; the editor returns to interactive.
- **Keep going** dismisses the confirm and returns to the calibration UI at the same step. No data sent.

6.3 **Pre-takeover state is sacred.** The firmware must hold the prior calibration in memory across the takeover and only commit new points to flash on `calibrate-end { commit: true }`. The "save-point" message stages the value; it does not flush per-step. This protects the user from data loss on disconnect / abort. (The wire protocol spec is the authoritative place for this rule; this section restates it for editor-side clarity.)

6.4 **Disconnect mid-takeover.** If hardware disconnects while the takeover is open:
1. The overlay shows a transient banner: `Hardware disconnected — calibration aborted, prior settings preserved.`
2. Auto-dismisses after 4 s, returning to the editor.
3. The firmware (on its side) is responsible for reverting on its next boot if `calibrate-end` was never received; this is a firmware-spec concern but mentioned here so editor behaviour reads coherent.

6.5 **No abort confirm if zero saves so far.** If the user has not yet saved any point (still on step 1, or skipped steps only) Abort skips the confirm and exits directly. There is nothing to discard.

---

## 7. Errors and Firmware Rejections

7.1 **Pre-flight rejection** (rejection on `calibrate-begin`):
- The picker stays open with an inline error row: `a1 calibration unavailable: <reason>`.
- The user can pick a different output or cancel.

7.2 **Mid-takeover rejection.** Any `calibrate-set-target`, `calibrate-adjust`, or `calibrate-save-point` rejection surfaces inline within the takeover, replacing the helper text:

```
   ▌ Error: flash write failed.
   ▌ The point was not saved.
   ▌
   ▌ [ Retry save ]    [ Abort ]
```

- The flow **stays on the current step**. The user is not kicked out.
- `Retry save` re-issues the same `calibrate-save-point`. Most write-failure cases are transient (flash busy, command race) and recover on retry.
- `Abort` opens the standard abort confirm (§6.2).
- Firmware-side authoritative state (e.g. clamped offset) is read from the rejection envelope and the editor's slider snaps to the firmware's value (§4.5) so the UI stays truthful.

7.3 **Severity-aware future enhancement.** A future protocol may classify rejections as `transient` vs `fatal` (deferred — §10.2). Until then, all rejections render as transient (retryable in place); the user can always Abort if a problem persists.

7.4 **Telemetry.** All firmware errors during calibration are mirrored to the console log even though the takeover hides it visually. On exit, the user sees the log.

---

## 8. Persistence

8.1 **Calibration data lives on the module's flash.** The editor does not persist calibration values locally; the firmware is the source of truth. The editor reads "current calibration status" per output from the firmware in two places:
- The pre-flight picker (§2.2) on open.
- An optional `Hardware Status` settings row that lists per-output status (`uncalibrated` / `calibrated <date>` / `partial`).

8.2 **The editor *does* persist a few preferences** under `calibration.*`:
- `calibration.helperTextShown: boolean` — once the user has completed their first calibration, the helper text below the slider auto-hides on subsequent runs (a "show again" link is always present).
- `calibration.lastOutput: string` — remembers the last output picked, so the picker pre-selects it next time.

8.3 **Multi-tab.** Web Serial is single-tab; calibration is by definition single-tab. No cross-tab sync needed.

---

## 9. Settings

Calibration-related settings live under `calibration.*`:

9.1 `calibration.octaveRange: { from: number; to: number }` — default `{ from: 0, to: 4 }`. Reserved for future override; not user-exposed in MVP UI.

9.2 `calibration.sliderRangeCents: number` — default `50`. The ±extent of the adjust slider in cents (§4.1).

9.3 `calibration.snapZeroToleranceCents: number` — default `0.3`. Soft-detent tolerance for the slider's zero snap (§4.1).

9.4 `calibration.fineStepCents: number` — default `0.1`. Step size for `Shift+arrow`/`Shift+scroll` (§4.2).

9.5 `calibration.coarseStepCents: number` — default `10`. Step size for `Ctrl+arrow` (§4.2).

9.6 `calibration.helperTextShown: boolean` — default `true`; flips to `false` after first completed calibration (§8.2). Re-enable via the inline "show again" link or in settings.

9.7 `calibration.carryForwardOffset: boolean` — default `true`. Whether the next octave starts at the previous octave's offset (§4.3) or at zero.

---

## 10. Open / Deferred

10.1 **Multi-output batch mode.** Walk all outputs end-to-end (`a1: 0V…4V → a2: 0V…4V → …`) without intermediate prompts. Useful for first-time setup. Deferred: the per-output "next?" prompt covers it for v1, and batch mode adds confirm/abort scope ambiguity.

10.2 **Severity-classified rejections.** Protocol-level distinction between `transient` and `fatal` rejections (§7.3). Today everything is transient.

10.3 **Fine-grained octave selection.** Letting the user choose which octaves to calibrate at session start (e.g. "skip 0V — my synth doesn't track that low"). Today the user can `Skip` per step but cannot pre-select; deferred.

10.4 **Calibration export / import.** Reading the per-output offsets out of flash to a JSON file (and writing back) for backup or sharing. Out of v1; firmware does not yet expose this.

10.5 **Live tuner readback over Web MIDI.** A future enhancement could read pitch from a USB tuner or MIDI-capable instrument and auto-detect the cents offset. This would change the flow from "user reads tuner, dials slider" to "editor reads tuner, presents detected offset; user confirms." Out of v1; tracked as a long-tail feature.

10.6 **Display scope option.** Some users prefer to see the offset in millivolts rather than cents. A `calibration.displayUnit: "cents" | "mv"` setting could swap the readout. Cents is more musical; mV is more electrical. Today: cents only.

10.7 **Per-octave time limit.** Some calibration utilities auto-skip if the user idles too long on one octave. Not applicable here — calibration is a focused task and we have explicit Skip; no timeout.
