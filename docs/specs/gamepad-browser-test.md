---
stability: evolving
layer: cross-cutting
non-normative: true
---

# Gamepad browser test script

> Manual test plan for the new three-stage gamepad pipeline.
> Run `npm run dev` and open the app. Connect a gamepad (Xbox/PS layout).
> Test each section below. If the gamepad isn't available, many actions have keyboard equivalents noted.

### Source files

- `src/lib/gamepad/index.ts` — `createGamepadPipeline()` (the pipeline under test)
- `src/lib/gamepad/hardware.ts` — Stage 1 hardware polling adapter
- `src/lib/gamepad/gamepadManager.ts` — low-level Gamepad API polling
- `src/lib/gamepad/paradigms/modal-shift.ts` — default paradigm tested here
- `src/lib/gamepad/paradigms/radial.ts` — full-takeover layer active during menu tests
- `src/contracts/gamepadChannels.ts` — typed channels (subscribe in console for debugging)
- `src/editors/gamepadNavigation.ts` — editor-context reader and manual-control axis bridge
- `src/editors/commands/actionHandlers.ts` — handler registry; dispatches `nav.up`/`nav.down`/`nav.left`/`nav.right` and other ActionIds to the structural dispatcher
- `src/lib/menu/dispatcher.ts` — menu action, axis, freeze, and mutation bridge

---

## Prerequisites

1. `npm run dev` running, app open at `https://useq-perform.localhost`
2. Gamepad connected and recognized (check browser devtools: `navigator.getGamepads()`)
3. Editor has some code — paste this test program:

```clojure
(+ 1 2 3)
(* (sin (time)) 0.5)
(list 1 2 3 4 5)
```

---

## 1. Basic navigation (D-pad) (see `src/editors/gamepadNavigation.ts`)

| Action | Gamepad | Expected |
|--------|---------|----------|
| Move up | D-pad Up | Cursor moves to line above |
| Move down | D-pad Down | Cursor moves to line below |
| Move left | D-pad Left | Cursor moves left (spatial) or prev sibling (structural) |
| Move right | D-pad Right | Cursor moves right (spatial) or next sibling (structural) |
| Held repeat | Hold D-pad Up | Cursor keeps moving at auto-repeat rate (~60ms ticks after 300ms delay) |

**Pass criteria**: cursor moves in the correct direction, held repeat fires continuously.

## 2. Navigation mode toggle

| Action | Gamepad | Keyboard equiv |
|--------|---------|----------------|
| Toggle spatial ↔ structural | Back button | — |

**Test**: Press Back, then try D-pad — behavior should switch between spatial (cursor-line) and structural (AST-node) navigation.

## 3. Drill in / drill out

| Action | Gamepad | Expected |
|--------|---------|----------|
| Drill into node | A button | Cursor enters the expression at cursor |
| Drill out of node | B button | Cursor moves to parent expression |

**Test**: Place cursor on `(list 1 2 3 4 5)`, press A to drill into it, then press B to drill back out.

## 4. Evaluation

| Action | Gamepad | Keyboard equiv |
|--------|---------|----------------|
| Evaluate expression | Start | Ctrl-Enter |

**Test**: Place cursor on `(+ 1 2 3)`, press Start. Should evaluate and show result.

## 5. Delete

| Action | Gamepad | Expected |
|--------|---------|----------|
| Delete node at cursor | Y button | Deletes the node under cursor |

**Test**: Place cursor on a number like `3` inside the list, press Y. The number should be deleted.

## 6. Menu system (see `src/lib/menu/dispatcher.ts`, `src/lib/gamepad/paradigms/radial.ts`)

| Action | Gamepad | Expected |
|--------|---------|----------|
| Open radial menu | X button | Radial menu opens |
| Open menu before | LB+A chord (press together) | Insert menu opens in "before" direction |
| Open menu after | RB+A chord (press together) | Insert menu opens in "after" direction |

**Test**: Press X — the create menu should open. Then test navigation within the menu:

### 6a. Ring and verb selection (while menu is open)

| Action | Gamepad | Expected |
|--------|---------|----------|
| Select rings | Left/right sticks | Each engaged stick highlights one ring item |
| Freeze selection | LB or RB press | Latches both highlighted items |
| Apply Insert | A button while frozen | Inserts the selected item |
| Apply Replace / WrapWith / Call | X / Y / B while frozen | Applies the corresponding menu verb |
| Cancel | Back button | Steps back from frozen, or closes the menu |

**Pass criteria**: the radial layer activates when the menu opens and deactivates when it closes. Unbound controls such as D-pad do not leak through to the editor.

## 7. Manual control

| Action | Gamepad | Expected |
|--------|---------|----------|
| Toggle manual control | Left/Right stick press | Toggles stick-to-number binding |
| Stick axis | Move right stick | Publishes continuous axis values |

**Test**: Press left stick in, then move it — check if number at cursor changes (if manual control is active).

## 8. LB-shifted layer (structural editing) (see `src/lib/gamepad/paradigms/modal-shift.ts`, `src/editors/commands/actionHandlers.ts`)

Hold LB, then press:

| Combo | Action | Expected |
|-------|--------|----------|
| LB + A (hold LB, tap A) | Slurp forward | Pulls next sibling into current list |
| LB + B | Barf forward | Pushes last element out of current list |
| LB + X | Slurp backward | Pulls prev sibling into current list |
| LB + Y | Barf backward | Pushes first element out of current list |

**Distinction from chord**: LB-shifted means **hold** LB first, then tap the action button. The `when:` predicate checks `heldButtons.has("LB")`. This is different from the LB+A chord (which requires near-simultaneous presses within 30ms).

**Test**: In `(+ 1 2 3)`, put cursor on `+`, hold LB, tap A → should slurp `1` into the expression if at list boundary.

## 9. RB-shifted layer (probes)

Hold RB, then press:

| Combo | Action | Expected |
|-------|--------|----------|
| RB + A | Toggle probe | Toggles inline probe on expression |
| RB + B | Toggle raw probe | Toggles raw value probe |
| RB + X | Expand probe | Expands probe context |
| RB + Y | Contract probe | Contracts probe context |
| RB + Start | Soft eval | Evaluates in soft mode |
| RB + Back | Redo | Redo last undo |

## 10. Regression checks (see `src/lib/gamepad/gamepadManager.ts` for disconnect handling)

| Check | Expected |
|-------|----------|
| Gamepad disconnect | App doesn't crash. Reconnecting resumes input. |
| No gamepad connected | App runs normally with keyboard only. No console errors. |
| Keyboard still works | All existing keyboard shortcuts (Ctrl-Enter eval, arrow keys, etc.) unaffected. |
| No double-fires | Actions fire exactly once per press, not twice. Check: eval only evaluates once per Start press. |

---

## Console debugging (see `src/contracts/gamepadChannels.ts`)

Open browser devtools console. The pipeline publishes to typed channels — you can verify by subscribing:

```js
// In browser console:
// Manual-control axis is the sole remaining gamepad channel. Discrete input
// resolves to ActionId and is executed through actionHandlers.ts.
import('/src/contracts/gamepadChannels.ts').then(ch => {
  ch.stickAxis.subscribe(e => console.log('stickAxis', e));
});
```

If an action fires through the keybinding handler directly (eval, undo, redo, probes), it won't show up on the channel — that's correct.
