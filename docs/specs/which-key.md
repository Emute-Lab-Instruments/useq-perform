---
stability: evolving
layer: behavioural
---

# Which-Key (Modifier Hints)

> Spec: the modifier-hint overlay ("which-key popup") — display modes, chord
> transitions, click-to-execute interactivity, inline namespace expansion.
> Counterpart to [keybindings.md](keybindings.md) §1.11 and [overlays.md](overlays.md).

### Source files

- `src/ui/keybindings/ModifierHints.tsx` — orchestrator component (visibility, keyboard events, mode routing)
- `src/ui/keybindings/hintStateMachine.ts` — state machine + `pendingChordPrefix` reactive signal (the chord bridge)
- `src/lib/keybindings/actions.ts` — action registry (metadata, categories)
- `src/lib/keybindings/defaults.ts` — default key-to-action maps
- `src/lib/keybindings/handlers.ts` — action-to-implementation mapping, `executeEditorCommand()`
- `src/lib/settings/schema.ts` — `KeybindingsSettings` (contains hint settings)

---

## 1. Purpose

1.1 The which-key popup is the primary discoverability surface for modifier-based
keybindings and chord sequences. Its job is to reduce memory load: a performer
holds a modifier and the popup shows what's available without requiring rote
memorisation of the full keymap.

1.2 The popup must solve the "chord blindness" problem: when a user presses a
chord leader (e.g. `Alt+o`), the current implementation dismisses the popup —
exactly when the user needs guidance about available completions. The redesign
ensures the popup **transitions** into chord-completion mode rather than
disappearing.

---

## 2. Settings

2.1 The `keybindings` settings section gains one new field:

| Field | Type | Default | Description |
|---|---|---|---|
| `modifierHintDelay` | `number` | `500` | Milliseconds before the overlay appears after holding a modifier. `0` disables. |
| `modifierHintStyle` | `"cursor" \| "bar" \| "modal"` | `"cursor"` | Display mode (see §4). |

2.2 Both settings are runtime-mutable via the settings panel. Changes take effect
on the next modifier hold (no restart required).

---

## 3. State Machine

3.1 The popup has three logical states:

```
                    ┌──────────┐
         hold mod   │  HIDDEN  │
        ──────────► │          │ ◄─── release / blur / escape / click-away (modal)
        (start      └────┬─────┘
         timer)          │
                         │ timer fires (modifierHintDelay ms)
                         ▼
                    ┌──────────┐
                    │ MODIFIER │  shows hints for held modifier
                    │  ACTIVE  │  (direct bindings + chord leaders)
                    └────┬─────┘
                         │
              ┌──────────┼──────────┐
              │          │          │
         press chord   click      release mod / non-chord key
         leader key    execute     ──────────────────────────────►  HIDDEN
              │          │
              ▼          ▼
        ┌──────────┐   execute action → HIDDEN
        │  CHORD   │
        │ PENDING  │   shows completions for the chord leader
        └────┬─────┘
             │
      ┌──────┼──────┐
      │      │      │
   press   click   timeout (chordTimeout ms) /
   2nd key execute  release / blur
      │      │      │
      ▼      ▼      ▼
   execute  execute  HIDDEN
   action   action
   → HIDDEN → HIDDEN
```

3.2 **HIDDEN → MODIFIER_ACTIVE**: A lone modifier key (`Control`, `Alt`,
`Meta`, `Shift`) is held without any other key pressed. A timer starts. If the
modifier is still held alone when the timer fires, the overlay becomes visible.

3.3 **MODIFIER_ACTIVE → CHORD_PENDING**: The user presses a key that is
recognised as a chord leader under the currently held modifier (e.g. `o` while
`Alt` is held, and `Alt-o` is a known chord prefix). The overlay transitions to
show the chord's completions. It does **not** dismiss.

3.3.1 **HIDDEN → CHORD_PENDING (early chord)**: If the modifier is held but the
hold timer has not yet fired (state is still HIDDEN) and the user presses a
chord leader under that modifier, the overlay jumps straight to CHORD_PENDING
and shows completions. This honours §6.1 ("…or even if it hasn't appeared yet")
so the popup never misses a fast chord. A non-leader key in this situation
returns to HIDDEN (the direct binding executes normally).

3.4 **MODIFIER_ACTIVE → HIDDEN**: The user presses a non-leader key (executes a
direct binding) or releases the modifier. The overlay dismisses immediately.

3.5 **CHORD_PENDING → HIDDEN**: The user presses a completion key (action
executes), clicks an entry (action executes), or the chord times out
(`keybindings.chordTimeout` ms, default 1500).

3.6 **Any state → HIDDEN**: Window blur, Escape key, or (in modal mode)
clicking the backdrop.

---

## 4. Display Modes

### 4.1 `"cursor"` — at-cursor single column (current behaviour, enhanced)

Position: floating near the editor cursor. Falls back to upper-third
screen-center if no cursor is found.

Layout: single column, all entries in one vertical list.

Best for: quick glances during performance; minimal visual intrusion.

```
                        ┌───────────────────────┐
    (code here)         │ Alt + ...             │
    (code here) █       │───────────────────────│
    (code here)         │  /   Help             │
                        │  g   Visualisation    │
                        │  p   Toggle probe     │
                        │  e → Structure... [▸] │
                        │  o → Observe...   [▸] │
                        └───────────────────────┘
```

### 4.2 `"bar"` — bottom-anchored multi-column

Position: fixed to the bottom edge of the viewport, full width with horizontal
padding (16px sides, 16px bottom).

Layout: entries grouped by `ActionCategory` and flowed into 2–3 columns
(adaptive based on entry count and viewport width).

Best for: learning mode; the user can see all bindings at once while still
seeing the editor above.

```
┌──────────────────────────────────────────────────────────────────────┐
│ (editor content visible above)                                       │
├──────────────────────────────────────────────────────────────────────┤
│                          Alt + ...                                    │
│──────────────────────────────────────────────────────────────────────│
│  ⏎  Eval (quantised)  │  /  Help           │  e → Structure...  [▾] │
│  g  Visualisation      │  f  Documentation  │    ]  Slurp fwd        │
│  p  Toggle probe       │  r  Raise          │    [  Slurp back       │
│  h  Expand probe       │  s  Splice         │    w  Wrap list        │
│  ↓  Transpose fwd      │  ↑  Transpose back │  o → Observe...   [▸] │
└──────────────────────────────────────────────────────────────────────┘
```

Does not push editor content up — it overlays above the bottom edge. Entries
that overflow the available height scroll internally.

### 4.3 `"modal"` — centred overlay with backdrop

Position: centred both horizontally and vertically, with a dim backdrop
(`rgba(0,0,0,0.4)`).

Layout: 2–3 columns with category group headers. Maximum width 80vw, maximum
height 70vh with overflow scroll.

Best for: cheat-sheet mode; maximal discoverability; explicitly summoned for
reference.

```
┌──────────────────────────────────────────────────────────────────────┐
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
│ ░░┌──────────────────────────────────────────────────────────────┐░░│
│ ░░│                        Alt + ...                             │░░│
│ ░░│──────────────────────────────────────────────────────────────│░░│
│ ░░│  Eval              │  Probes            │  Structure     [▾] │░░│
│ ░░│  ⏎  Quantised eval │  p  Toggle probe   │    ]  Slurp fwd   │░░│
│ ░░│                    │  h  Expand context  │    [  Slurp back  │░░│
│ ░░│  Panels            │  s  Contract        │    r  Raise       │░░│
│ ░░│  /  Help           │                     │    s  Splice      │░░│
│ ░░│  g  Vis            │  Observe         [▸]│    w  Wrap list   │░░│
│ ░░│  f  Docs           │                     │    v  Wrap vector │░░│
│ ░░└──────────────────────────────────────────────────────────────┘░░│
│ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└──────────────────────────────────────────────────────────────────────┘
```

Dismisses on: backdrop click, Escape, or executing an action.

### 4.4 Responsive column count

All modes use a shared column-count function:

| Style | Entry count ≤6 | Entry count 7–14 | Entry count ≥15 |
|---|---|---|---|
| `cursor` | 1 | 1 | 1 |
| `bar` | 1 | 2 | 3 |
| `modal` | 1 | 2 | 3 |

---

## 5. Interactivity

### 5.1 Click-to-execute

All entries are clickable. Clicking an entry executes the associated action
immediately and dismisses the popup.

5.1.1 Every clickable element must call `e.preventDefault()` on `mousedown` to
prevent stealing focus from the CodeMirror editor.

5.1.2 Execution uses the handler registry (`src/lib/keybindings/handlers.ts`).
If the handler expects an `EditorView` argument, the currently focused editor
view is supplied. If no editor is focused, the action is a no-op.

5.1.3 After execution, the popup transitions to HIDDEN.

### 5.2 Inline namespace expansion

Chord-leader rows display a toggle button (`▸` collapsed / `▾` expanded).

5.2.1 Clicking the toggle button (not the row itself) expands the chord's
child bindings inline, indented beneath the leader row.

5.2.2 Expanding a namespace does **not** commit the chord leader keystroke —
the user remains in MODIFIER_ACTIVE state and can still press a different key.

5.2.3 Clicking an expanded child row executes that action directly (equivalent
to pressing the full chord sequence).

5.2.4 Multiple namespaces may be expanded simultaneously.

5.2.5 Expansion state resets when the popup transitions to HIDDEN.

### 5.3 Focus management

5.3.1 The popup must never appear in the tab order or receive keyboard focus.
All interactivity is mouse/touch only.

5.3.2 `pointer-events: none` is removed (required for interactivity), but all
`mousedown` handlers call `preventDefault()` to prevent focus shift.

5.3.3 The popup does not participate in the overlay stack
(`src/ui/overlayManager.ts`). It is a transient hint surface, not a modal or
picker.

---

## 6. Chord Transition

### 6.1 Detection

When a non-modifier key is pressed while the popup is visible (or even if it
hasn't appeared yet — the modifier is held), the system checks whether the
composed key (`<modifier>-<key>`) is a known chord leader.

6.1.1 A "known chord leader" is any key string that appears as a prefix (before
a space) in the default bindings or active resolved bindings.

6.1.2 If the key is a chord leader, `setPendingChord("<modifier>-<key>")` is
called. The popup transitions to CHORD_PENDING and shows completions for that
chord.

6.1.3 If the key is **not** a chord leader, the popup dismisses (the key is a
direct binding being executed).

### 6.2 Chord completions

In CHORD_PENDING state, the popup shows:
- Header: `Alt+o → ...` (the committed chord prefix)
- Entries: all second-stroke keys with their action descriptions

The entries are clickable (§5.1 applies).

### 6.3 CodeMirror integration

6.3.1 The `pendingChordPrefix` signal in
`src/ui/keybindings/hintStateMachine.ts` is the single source of truth for the
committed chord prefix. The popup renders its completions from this signal; it
is the bridge between the popup's view and the held-modifier/chord state.

6.3.2 Detection of chord-leader status is done by the state machine itself
(via `isChordLeader()` in `hintData.ts`, which inspects the binding list for
multi-stroke keys matching the current modifier + pressed key). It does not
require access to CodeMirror's private `currentPrefixes` state.

6.3.3 The popup's `onKeyDown` handler runs at capture phase (`{ capture: true }`)
so it sees keystrokes before CodeMirror processes them. In the default
(non-sticky) path it sets `pendingChordPrefix` and lets the event propagate —
CodeMirror still handles the chord normally. In **sticky** mode the popup
intercepts the bare key (`preventDefault` + `stopPropagation`) and executes the
binding itself (§5 sticky behaviour).

---

## 7. Data Model

### 7.1 HintEntry

```typescript
interface HintEntry {
  key: string;            // raw key (e.g. "o", "]", "Enter")
  displayKey: string;     // rendered label (may differ: "⏎" for Enter)
  actionId: ActionId | null; // null for chord-namespace header rows
  description: string;
  category: ActionCategory;
  isChord: boolean;
  children?: HintEntry[]; // populated for chord namespaces
}
```

### 7.2 Category grouping (bar and modal modes)

In multi-column modes, entries are grouped by `ActionCategory` in the order
defined by `CATEGORY_ORDER` in `src/ui/keybindings/hintData.ts`:
`core` → `editor` → `structure` → `format` → `probe` → `navigation` → `ui` →
`transport`. The `gamepad` and `menu` categories are intentionally omitted —
they have no keyboard bindings, so the modifier-hint popup never shows them.

Category groups stay together in a single column (never split across columns).
Columns are balanced by total row count.

### 7.3 Chord completions data

When in CHORD_PENDING state, a `getChordCompletions(prefix: string)` function
returns all `HintEntry` items whose binding starts with the given prefix (e.g.
`"Alt-o "`) — extracting the second-stroke key and action metadata.

---

## 8. Component Architecture

```
ModifierHints (orchestrator — state machine, keyboard events, mode dispatch)
├── ModifierHintsCursor    (style: "cursor" — single col, positioned at cursor)
├── ModifierHintsBar       (style: "bar" — bottom-fixed, multi-col)
└── ModifierHintsModal     (style: "modal" — centred overlay, multi-col, backdrop)
    └── HintColumns        (shared: splits entries into N balanced columns)
        └── HintRow        (shared: key badge + description + optional expand toggle)
            └── HintChildRows (expanded chord children, indented)
```

8.1 The orchestrator owns: visibility state, held-modifier signal,
pending-chord signal, hold timer, expanded-namespace set. It passes data and
callbacks to the mode-specific layout component.

8.2 `HintRow` and `HintColumns` are shared across all three modes. Only
positioning, sizing, and backdrop differ between modes.

---

## 9. Styling

9.1 The popup uses CSS custom properties from the active theme for colours
(`--panel-bg`, `--border`, `--text`, `--text-muted`, `--accent`).

9.2 Key badges use a monospace font, slight background tint, and rounded
corners — visually distinct from description text.

9.3 Chord-arrow indicator (`→`) appears between the key badge and description
for leader rows.

9.4 Expanded child rows are indented (left padding) to visually nest under
their parent leader row.

9.5 In `"modal"` mode, the backdrop animates in (opacity 0→1, ~100ms). The
popup itself scales in (0.95→1.0 + opacity, ~120ms).

9.6 Transitions between MODIFIER_ACTIVE and CHORD_PENDING content should
crossfade or slide (subtle, ≤150ms) rather than hard-cutting.

---

## 10. Accessibility

10.1 The popup has `role="tooltip"` in cursor mode and `role="dialog"` in modal
mode. Bar mode uses `role="complementary"`.

10.2 While the popup is visible, `aria-live="polite"` announces the header text
to screen readers.

10.3 The popup is not keyboard-navigable (§5.3.1) — keyboard input always goes
to the editor or executes bindings directly. Mouse/touch is the only click
interaction path.

---

## 11. Invariants

11.1 The popup must **never** steal keyboard focus from the editor. Any
implementation that moves `document.activeElement` away from the editor when the
popup appears is a bug.

11.2 The popup must **never** interfere with the normal keystroke flow.
CodeMirror must still receive and process all key events. The popup is an
observer and reactor, not an interceptor.

11.3 The popup must not block the hot eval path. Showing/hiding the popup is a
UI-only operation with zero coupling to the eval or rendering pipelines.

11.4 Holding two modifiers simultaneously (e.g. `Ctrl+Shift`) shows hints for
the combined prefix if any bindings exist. If none exist, no popup appears.

11.5 If `modifierHintDelay` is `0`, the popup is completely disabled. No timers
are set, no keyboard listeners fire for hint purposes.

---

## 12. Comparison of Display Modes

| Feature | `cursor` | `bar` | `modal` |
|---|---|---|---|
| Position | At editor cursor | Bottom-fixed, full width | Centre overlay |
| Columns | 1 | 2–3 (adaptive) | 2–3 (adaptive) |
| Category grouping | No | Yes | Yes |
| Backdrop dim | No | No | Yes |
| Dismiss on click-away | N/A (no backdrop) | No (anchored) | Yes |
| Max visible entries | ~10 before scroll | ~30+ (viewport height) | ~40+ (70vh) |
| Ideal use | Quick glance | Learning / reference | Cheat sheet |
| Editor occlusion | Minimal (small popup) | Bottom portion | Full (dim) |

---

## 13. Open / Deferred

13.1 **Gamepad trigger.** Whether a gamepad button hold (e.g. holding L1) should
trigger the equivalent of "modifier held" and show the popup is undecided.
Deferred to [gamepad.md](gamepad.md) scope.

13.2 **Search/filter in modal mode.** A text input that filters entries while
the modal is showing could be useful at scale. Conflicts with §5.3.1
(no keyboard focus in popup). Deferred — the action palette (`Mod-Shift-P`)
already provides fuzzy-searchable action lookup.

13.3 **User-configurable categories/groups.** Whether the multi-column modes
should allow the user to define custom category groupings or rename labels is
undecided.

13.4 **Animation budget.** The crossfade between states (§9.6) must not exceed
150ms or introduce layout thrash. If performance profiling shows jank on low-end
hardware, animations should be removed rather than extended.
