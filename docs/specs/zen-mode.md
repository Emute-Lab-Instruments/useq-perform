# Zen mode

> Spec: distraction-free practice environment for structural editing with gamepad (or keyboard).
> Doubles as an in-editor playground for testing structural editing controls and behaviours.
> See also [structural-editing.md](structural-editing.md) (the algebra), [gamepad.md](gamepad.md) (input pipeline), [editor.md](editor.md) (editor modes).

---

## 1. Frame

1.1 Zen mode is a **full-screen takeover** that replaces the normal app chrome (toolbar, visualisation, help panel) with a minimal exercise environment: one editor, one prompt bar, one progress grid.

1.2 Its purpose is twofold: (a) teach the user structural editing operations through repetition and progressive challenge, and (b) serve as a **test harness** for the developer to exercise the full gamepad pipeline against known inputs and expected outputs.

1.3 Zen mode is **input-agnostic**. It dynamically detects whether the user is using a gamepad or keyboard and shows appropriate button/key hints. If the user switches mid-exercise, hints adapt immediately.

1.4 Zen mode operates on a **temporary paradigm** — the user can select any gamepad binding paradigm from a dropdown without affecting their persisted settings. The selected paradigm determines button hints shown in exercises.

1.5 Zen mode is a **separate route** (`#/zen`, with optional exercise params `#/zen/<category>/<index>`). Bookmarkable, deep-linkable, useful for automated testing.

1.6 No audio. No haptics. Purely visual feedback.

---

## 2. Entry and exit

2.1 **Entry points:**
- Keyboard shortcut (configurable, default `Ctrl+Shift+Z`)
- Menu item (in Help or toolbar)
- Gamepad gesture (hold `Start`+`Back` for 1s)
- Direct URL navigation (`#/zen`)

2.2 **First-launch nudge.** On the first gamepad connection event ever detected (per-browser, tracked in localStorage), a subtle toast appears: "Try zen mode to practice structural editing with your controller." Toast is dismissible, shows only once.

2.3 **Exit:**
- `Esc` / gamepad `Back` from the grid home screen
- Navigating away via URL
- A persistent "Exit" affordance in the corner

2.4 On exit, the normal app UI is fully restored. No editor state from zen mode leaks into the main editor.

---

## 3. Structure: the grid

3.1 The **grid home screen** is the primary view of zen mode. It is always the first thing shown on entry (unless a deep-link targets a specific exercise).

3.2 The grid is organised as **rows** (categories) and **columns** (exercises within a category). Each row can have any number of exercises; rows scroll horizontally to fit the available width.

3.3 **Categories** (rows) map to the structural editing ontology:

| Row | Domain | Example exercises |
|-----|--------|-------------------|
| Navigation | `nav.*` | Move up/down/left/right, drill in/out, first/last |
| Slurp & Barf | `edit.slurp*`, `edit.barf*` | Slurp forward, slurp backward, barf forward, barf backward |
| Raise & Splice | `edit.raise`, `edit.splice` | Raise a node, splice a list open |
| Wrap | `edit.wrap.*` | Wrap in list, vector, map, set |
| Transpose | `edit.transpose*` | Swap siblings forward/backward |
| Combos | multi-op | Navigate + mutate sequences, reshape challenges |

3.4 Each cell is a **card** showing:
- A tiny code preview (the exercise's starting state)
- A one-word operation label or directional arrow
- Completion state: filled/glowing (done), outlined (available), current (pulsing)

3.5 **All exercises are unlocked from the start.** Progress is tracked but nothing is gated. The user can jump to any exercise at any time.

3.6 A **"Continue" button** is prominently placed at the top of the grid. It drops the user into the next incomplete exercise (scanning left-to-right, top-to-bottom). First-time users can just hit Continue repeatedly for a linear experience.

3.7 The grid is navigable by both gamepad (D-pad + A to select) and keyboard (arrows + Enter).

---

## 4. Exercise anatomy

### 4.1 Authoring format

Exercises are authored using a TypeScript DSL with inline cursor markers. The `«»` pair marks the structural cursor position in both start and target code:

```ts
exercise('slurp-fwd-1', {
  title: 'Slurp the 3',
  category: 'slurp-barf',
  start:  '«(+ 1 2)» 3',
  target: '«(+ 1 2 3)»',
  prompt: 'ghost',
  actions: ['edit.slurpFwd'],
  hints: ['Slurp pulls the next sibling in'],
})

exercise('nav-down-1', {
  title: 'Drill into list',
  category: 'navigation',
  start:  '«(+ 1 2 3)»',
  target: '(«+» 1 2 3)',
  prompt: 'spotlight',
  actions: ['nav.structuralDown'],
})

exercise('reshape-1', {
  title: 'Unwrap the inner list',
  category: 'combos',
  start:  '(map «(fn [x] x)» items)',
  target: '(map «fn» [x] x items)',
  prompt: 'puzzle',
  actions: ['edit.splice'],
  hints: ['This list should disappear but its children should remain'],
})
```

4.1.1 The `«»` markers are stripped before loading into the editor; the parser uses them to identify which node the cursor should land on (by matching the text content between markers against the parsed AST).

4.1.2 For multi-line exercises, the code strings use template literals. Cursor markers work identically across lines.

4.1.3 For **range cursors** (selecting multiple siblings), use `«` before the first node and `»` after the last: `(+ «1 2 3»)` selects the range `[1, 2, 3]`.

### 4.2 Internal types

The `exercise()` helper parses the DSL into the internal representation:

```ts
interface Exercise {
  id: string
  category: CategoryId
  title: string
  startCode: string                   // markers stripped
  startCursor: CursorSpec             // derived from «» in start
  targetCode: string                  // markers stripped
  targetCursor: CursorSpec            // derived from «» in target
  promptMode: PromptMode
  optimalActions?: ActionId[]
  hints?: string[]
}

type PromptMode = 'ghost' | 'spotlight' | 'beforeAfter' | 'puzzle'

type CursorSpec =
  | { kind: 'path'; path: number[] }  // tree path from root (computed from marker)
  | { kind: 'text'; match: string }   // fallback: node whose text matches marker content
```

4.2.1 **AST validation** uses `targetCode` — the system parses it at exercise load time and compares the tree structure (ignoring whitespace) against the editor's live parse tree. No hand-written `AstSpec` objects.

4.2.2 **Cursor validation** uses `targetCursor` — derived from the `«»` position in the target string. The cursor must be on the correct node for the exercise to complete.

4.2 **Prompt modes** (each exercise picks one):

| Mode | Visual | Best for |
|------|--------|----------|
| `ghost` | Target code shown as translucent overlay on the editor. User edits until they match. | Mutations where the result is a rearrangement of existing code |
| `spotlight` | Target node highlighted with glow/halo + short action label in the top bar | Navigation exercises, single-op mutations |
| `beforeAfter` | Current state on left half, target state on right half (or stacked) | Complex reshaping where seeing both states helps |
| `puzzle` | Only the target state shown (no hints about which operation). Figure it out. | Later stages, combos, mastery challenges |

4.3 The **top bar** (always visible during an exercise) shows:
- Operation icon + short text (e.g. "→→ Slurp forward")
- Button/key hint for the operation (derived from active paradigm + detected input device)
- Exercise counter: `3/7` within the current category

---

## 5. Exercise flow

5.1 **Enter exercise**: Card slide-in animation (from right). Editor appears with `startCode` loaded, structural cursor placed at `startCursor`. Prompt mode renders the goal.

5.2 **During exercise**: User performs structural editing operations. The editor is fully functional within the structural editing algebra — all operations work, undo works freely.

5.3 **Validation**: After every action, the system compares the current AST against `targetAst` (and `targetCursor` if specified). If match → exercise complete.

5.4 **Gentle nudge**: After 3 wrong moves (moves that don't bring the AST closer to the target), show the first hint from the exercise's `hints[]` array. After 5 wrong moves, show the next hint. After 8 wrong moves, show the exact action needed (derived from `optimalActions`). Hints appear as a dim line below the top bar, not as a modal.

5.5 **Completion**: Brief green glow on the editor border (200ms fade-in, 300ms hold, 200ms fade-out). After ~500ms total, auto-advance to the next exercise in the same category via card-slide animation. If the category is complete, return to the grid with the completed row visually updated.

5.6 **Undo**: Fully available. The user can undo any number of moves. The exercise only validates forward progress — it never resets automatically. (Future: a "hard mode" setting that resets on wrong moves.)

5.7 **Skip**: A subtle "Skip →" affordance lets the user skip any exercise without marking it complete.

---

## 6. Validation system

6.1 **Primary validation: AST comparison.** The system parses `targetCode` into an AST at exercise load time, then compares the editor's live parse tree against it after every action. Whitespace differences are ignored. Node types + content must match.

6.2 **Comparison algorithm.** Walk both trees in parallel. At each node: kind must match, text content must match (for atoms), child count and order must match (for compounds). Whitespace tokens and comments are skipped. This is a structural equality check, not a string comparison.

6.3 **Secondary tracking: action sequence.** If `optimalActions` is provided, the system records which `ActionId`s fired during the exercise. This is used for:
- Hint generation ("try slurp instead of delete+re-type")
- Performance stats (moves used vs optimal)
- Developer test harness (assert specific pipeline output)

6.4 **Cursor validation.** Completion requires both AST match AND cursor position match (cursor is always specified via the `«»` markers in `target`). This is important for navigation exercises where the tree doesn't change — only the cursor moves.

6.5 **Test harness integration.** Exercise definitions are plain data (importable in tests). A test can:
- Load an exercise's `startCode` + `startCursor`
- Feed synthetic `LogicalEvent[]` through the pipeline
- Assert the resulting AST matches the parsed `targetCode`
- Assert the action sequence matches `optimalActions`

---

## 7. Visual design

7.1 **Full-screen, dark, minimal.** Black or near-black background. The editor is the only bright element — centred, with generous padding. No toolbars, no sidebars, no chrome except the top bar and (when on the grid) the exercise cards.

7.2 **Editor**: Standard CodeMirror with structural editing extensions active. Themed to match zen mode's dark surround. Structural cursor halos are the primary visual signal.

7.3 **Top bar**: Thin (32-40px), semi-transparent background. Left-aligned: operation icon + label. Right-aligned: exercise counter + paradigm dropdown (small). Disappears on the grid screen.

7.4 **Card slide animation**: Each exercise is conceptually a card in a stack. Entering an exercise slides the new card in from the right (150ms ease-out). Completing slides it left and brings the next from the right. Returning to grid slides all cards away to reveal the grid beneath.

7.5 **Completion glow**: A soft green pulse on the editor's border/shadow. No confetti, no score popup, no text. Just a moment of visual satisfaction.

7.6 **Grid cards**: Rounded rectangles (~120x80px) with dark background, monospace code preview (tiny font, ~8-10px — legibility is secondary to pattern recognition). Category labels are left-aligned row headers in dim text.

7.7 **Input hint badges**: When showing button hints, use rounded pill badges with the button name. Gamepad: `[LB]` `[A]` in a distinct colour. Keyboard: `Ctrl` `Shift` `→` in a different colour. Badges animate in/out when input device changes.

---

## 8. Progress persistence

8.1 Progress is stored in **localStorage** under a single key (`useq:zen:progress`).

8.2 Schema:

```ts
interface ZenProgress {
  version: 1
  exercises: Record<ExerciseId, ExerciseProgress>
  lastExercise: ExerciseId | null
  paradigm: string | null             // last-used paradigm (not persisted to app settings)
}

interface ExerciseProgress {
  completed: boolean
  bestMoves: number | null            // fewest actions to complete
  bestTimeMs: number | null           // fastest completion time
  attempts: number
}
```

8.3 Progress is written on exercise completion. `lastExercise` is updated on every exercise entry (for the "Continue" button to resume).

8.4 A "Reset progress" option exists in the grid's corner menu (with confirmation).

---

## 9. Paradigm & input detection

9.1 On entering zen mode, the paradigm dropdown defaults to the user's active paradigm (from app settings) but subsequent changes are scoped to the zen session only.

9.2 **Input detection**: The system watches for the most recent input event. If a gamepad gesture arrives, hints switch to gamepad buttons. If a keyboard event arrives, hints switch to keyboard chords. Debounce of 500ms prevents flicker during transition.

9.3 **Hint derivation**: Given the exercise's target action (from `optimalActions[0]` or inferred from the operation), the system looks up which gesture/key produces that action in the active paradigm's layers. This is a reverse-lookup on the binding tables.

9.4 If no binding exists for the target action in the active paradigm (e.g. the paradigm doesn't bind `edit.splice` anywhere), the hint shows the operation name without a button badge, plus a dim note: "not bound in current paradigm."

---

## 10. Architecture

10.1 Zen mode is a **separate Solid component tree** mounted at the `#/zen` route. It does not share UI components with the main app (except low-level primitives like the editor adapter).

10.2 It creates its own **secondary editor** (per [editor.md](editor.md) §1.13) with structural editing extensions enabled. The editor is isolated — no effect modules, no transport, no visualisation.

10.3 The **gamepad pipeline** is shared with the main app (same recognizer, same paradigm layers). Zen mode adds its own predicate-driven layer that can intercept gestures for exercise-specific behaviour (e.g. disabling eval during pure-nav exercises).

10.4 **Exercise definitions** live in a data file (`src/zen/exercises.ts` or similar). They are plain typed objects — importable in both the UI and test suites.

10.5 **State management**: A small SolidJS store (`zenStore`) holds:
- Current view: `'grid' | 'exercise'`
- Active exercise ID
- Action log (for the current exercise)
- Detected input device: `'gamepad' | 'keyboard'`
- Active paradigm name

10.6 File layout (informative):

```
src/zen/
  index.tsx             // route component, mounts zen mode
  ZenGrid.tsx           // grid home screen
  ZenExercise.tsx       // exercise runner (editor + prompt + validation)
  exercises.ts          // exercise definitions (data)
  validation.ts         // AST comparison, cursor matching
  promptModes/
    Ghost.tsx           // ghost overlay prompt mode
    Spotlight.tsx       // spotlight/halo prompt mode
    BeforeAfter.tsx     // split-view prompt mode
    Puzzle.tsx          // target-only prompt mode
  store.ts              // zenStore
  progress.ts           // localStorage persistence
  hints.ts              // hint derivation + reverse binding lookup
  zen.css               // styles
```

---

## 11. Open / Deferred

11.1 **Hard mode.** A toggle that resets the exercise on any wrong move. Builds to a separate spec if desired.

11.2 **Custom exercises.** A future "exercise editor" where the user defines start/target pairs and adds them to the grid. Useful for testing specific edge cases.

11.3 **Timed challenges.** A stopwatch mode where exercises have a par time. Competitive self-improvement. Deferred until the base flow is solid.

11.4 **Multiplayer / ghost replay.** Record the user's action sequence and play it back as a ghost in future attempts. Or compare against another user's replay. Far future.

11.5 **Exercise generation from diffs.** Given two code snapshots, auto-generate an exercise whose `startCode` → `targetAst` captures the diff as structural edits. Would allow procedural exercise generation.

11.6 **Integration with guide system.** Whether zen mode exercises can be embedded inline in the existing help guide chapters (as interactive "try it" blocks) or remain a separate surface. The existing `Playground` component could potentially mount individual zen exercises.

11.7 **Accessibility.** Screen reader announcements for exercise state, completion, hints. Not in v1 but the architecture should not preclude it.
