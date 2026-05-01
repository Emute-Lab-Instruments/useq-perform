# PRD — Gamepad-only live coding sessions

> **Status:** Draft, 2026-05-01. Synthesised from an interview about (a) fleshing out the structural-editing implementation and (b) designing a custom, extensible double radial menu so a performer can run an entire uSEQ session with just a gamepad — no keyboard.
>
> Pairs with: `docs/specs/structural-editing.md` (the algebra), `docs/specs/gamepad.md` (the input pipeline), `docs/specs/live-edit.md` (knobs), and the new `docs/specs/radial-menu.md` (this PRD's normative companion).

---

## 1. Vision

A performer plugs in a gamepad and runs a complete uSEQ live-coding session with it: navigates code structurally, inserts and reshapes forms, dials knobs, evaluates, and manages transport — without ever touching a keyboard.

The keyboard is not banned. It remains the fastest text-entry surface for studio composition. But the gamepad path is **first-class and self-sufficient**: a performer should be able to run a whole session on the gamepad and not feel constrained to the point of frustration. Curated lists cover the common case (functions, names, literals, snippets); a numpad sub-mode (digits) and a T9 sub-mode (text) cover free-form values and new symbol coinage. The average performance-time edit takes seconds, not minutes, on the gamepad alone.

This is achieved by combining three already-specified surfaces with one new one:

| Surface | Spec | Role |
|---|---|---|
| Structural editing | `structural-editing.md` | The algebra — slurp/barf/raise/enclose/splice/transpose, navigation, modes; first-class hole nodes |
| Gamepad pipeline | `gamepad.md` | Hardware → logical events → gestures → actions; layer stack |
| Live-edit knobs | `live-edit.md` | Continuous control over already-typed numeric/boolean/keyword literals |
| **Radial menu** *(new)* | `radial-menu.md` | The discrete-content surface — picking *which* function, symbol, snippet, number, keyword to insert |

Direct gamepad bindings keep doing the verbs (slurp, raise, navigate). The radial menu provides the nouns (functions, names, literals). Together they cover the full live-coding workflow.

## 2. Why this matters

- **Embodiment.** Gamepad input is a bodily, low-latency, fault-tolerant surface that fits performance better than a keyboard. The hands stay in one position, eyes stay on the room (or projection) instead of darting to keys.
- **Accessibility.** Some performers cannot or prefer not to use keyboards on stage. Gamepad-only support removes that barrier.
- **Public demos and workshops.** A gamepad makes the act of live-coding visible (held controller is more legible than fingers on a keyboard) and lowers the barrier for newcomers to try the system at festivals/workshops.
- **The uSEQ identity.** uSEQ's hardware roots and embodied-control ethos are coherent with a gamepad-first interaction model. This is what the project should feel like at its centre.

## 3. The user journey

A performer at a festival. Gamepad in lap. Projection of the editor on the wall behind them. They've never touched a keyboard tonight.

1. **Open**: An empty document. Press `tap(Y)` → radial menu opens, centred. Left ring: tab `Functions`. Right ring populates with categories (Math, Audio, Control…). The cursor is on the document root; Insert against the root appends as the last top-level child (`radial-menu.md §5.1.1`).
2. **Pick a head**: Right stick selects `osc`. Hold `LB+A` → freeze, then verb: Insert. The empty document now contains `(osc ⟨freq⟩)`. Cursor lands on the `⟨freq⟩` hole.
3. **Auto-chain**: Because `⟨freq⟩` is a typed hole (number), the menu auto-reopens directly into the Numpad sub-mode (`radial-menu.md §14`). Left stick to outer-S = `0`, then face A; left stick north-west → `1`, face A; … or pick `440` from the common-numbers fast path on the Literals tab. Press Start to confirm. Hole filled; cursor lands on the parent `(osc 440)`.
4. **Evaluate**: A direct binding (e.g. `tap(Start)` per paradigm) fires `eval.now`. Sound starts.
5. **Tweak**: They navigate structurally to the `440`. The structural-editing layer's `liveEdit.mark` action is bound to a chord — they fire it; the literal becomes a `(live-edit 440 …)` knob. Right stick now drives the value continuously.
6. **Reshape**: Slurp/barf/wrap on direct bindings — no menu — restructure the form. The cursor follows. Live-edit Metas ride along through every mutation (per `structural-editing.md §6.5`).
7. **Add a layer**: Reopen the menu. Tab to `Snippets`. Pick `(slow N body)`. WrapWith verb (`Y`) wraps the existing `(osc 440)` as the body. Cursor jumps to the `⟨rate⟩` hole; menu auto-opens the Numpad sub-mode; type `4` and ✓. Now they've got `(slow 4 (osc 440))` with no keyboard.

The whole flow is muscle-memory in the structural ops, spatial-memory in the menu, and lives entirely on the gamepad.

## 4. Scope

### 4.1 In scope for v1

**Structural editing implementation.**
- A clean functional core: `(Tree, CursorSet) → (Tree, CursorSet)` operations, no CodeMirror dependence, fully unit-tested per `structural-editing.md`'s mandate.
- A thin CodeMirror adapter layer that maps document offsets to/from tree-node handles, executes the pure operations, and applies the resulting text edit.
- Cursor halo rendering (no character caret in structural mode), no-op flash, mode indicator.
- Bridges to `gamepad.md` (the structural layer's bindings call into the algebra) and `live-edit.md` (Metas ride along through ops).

**Radial menu.**
- A new `radial-menu.md` spec, fully replacing the current `DoubleRadialPicker`, `RadialMenu.tsx`, and `pickerMenuModel.ts`.
- The pick-then-apply two-phase model: live-tracked sticks navigate rings (no locks); LB/RB cycle tabs in pre-pick sub-phases; in `picking` (both sticks engaged), pressing LB or RB latches a `frozen` snapshot; while frozen, face buttons fire verbs with handedness from the held shoulder.
- Four apply verbs: **Insert** (A, directional), **Replace** (X), **WrapWith** (Y, directional), **Call** (B, directional). All operate on the structural cursor target. Distinct from structural-editing's `enclose` op, which produces `(target)` and stays on direct gamepad bindings.
- Three handedness values: `left` (LB held), `right` (RB held), `both` (LB+RB held — reserved no-op in v1).
- Four top-level tabs: `Functions`, `Symbols`, `Literals` (numbers + booleans + keywords), `Snippets`.
- Auto-chain pickers: holes (`($ name :type)`, first-class structural nodes per `structural-editing.md §2.9`) drive the menu to reopen scoped to the next hole's type until the form is fully filled.
- **Numpad** and **T9** sub-modes (`radial-menu.md §14`): phone-keypad-style stick-position grids for free-form digit and text entry, reachable via auto-chain on `:number` / `:string` / new-`:symbol` holes or via the `Type number` / `Type new symbol` synthetic items. v1 supports the full digit + alphabetic surface; arbitrary numeric and symbolic values are no longer keyboard-only.
- LT/RT analog scrub paginates the right ring when a category overflows segment count.
- A bundled JSON manifest (`src/lib/menu/manifest.json`) is the v1 single source of all menu data. Authoring is its own beads epic, parallel to code phases.
- Pin-to-favorites runtime customisation, persisted per origin.
- Centre breadcrumb + live preview during freeze, including verb thumbnails for all four verbs.

### 4.2 Explicitly out of v1

- Doc-derived live extraction of user-defined symbols (the JSON manifest's curated list is enough; doc-derived comes later via a context-provider interface).
- Pluggable third-party sources, snippet packs, plugin registries.
- Per-project menu manifests / "performance scripts".
- Reordering items within categories or building custom tabs.
- Multi-cursor and range-cursor menu application (single primary node-cursor only in v1; the structural algebra supports lifting later).
- Always-visible HUD or hold-to-summon variants of the menu (single-fire leader is the only v1 invocation).
- Pre-eval preview ("dry run") of an apply (preview shows but commit fires on verb-press).
- Meaningful behaviour for the `'both'` handedness modifier (the wiring exists; the meaning is reserved).
- One-shot tutorial overlay on first menu invocation (Zen mode is the v1 discoverability surface).
- Cross-tab live-edit sync, multi-controller support, MIDI/OSC bindings.
- Number-as-`live-edit` auto-wrap (numbers born as plain literals; user converts to live-edit explicitly).

## 5. Success criteria

A v1 ship is successful if:

- **End-to-end gamepad-only session works.** Build the user journey above into a Zen-mode-style demo exercise and verify a tester can complete it without touching a keyboard. The bar is *pragmatic completeness*: the tester can compose, eval, tweak, and reshape without ever feeling forced to reach for a keyboard. Curated lists handle the common case at speed; numpad/T9 handle the long tail without hopping surfaces.
- **Test coverage matches existing standards.** The structural-editing core has hardware-free unit tests at the same density as the gamepad pipeline (~150+ tests for the algebra, plus property tests). The radial-menu state machine has its own pure-function unit tests.
- **No regression in keyboard workflows.** Every existing keyboard chord still fires the same `ActionId`. Structural ops behave identically when invoked by either input device.
- **The menu invocation is fast.** From `tap(Y)` to first-pick-committed should average ≤ 800 ms for a trained user (target: 500 ms). This is the equivalent of a typed-token rate.
- **Discoverability for a first-time gamepad user.** A first-time user who has never seen the menu can open it, find `osc`, and insert it with apply-verb feedback in the centre, in ≤ 30 seconds. The Zen-mode "first gamepad" tutorial covers this.

## 6. Phased plan

The work decomposes into four code phases plus a parallel content phase. Each phase produces a runnable, testable increment.

### Phase A — Structural-editing functional core

1. Define the `Tree`, `Node`, `Cursor`, `CursorSet`, `Meta` types (`src/lib/structural/types.ts`).
2. Implement Lezer-tree → internal-tree conversion (`src/lib/structural/parse.ts`).
3. Implement pure operations: navigation (5.1), mutation (5.2), document-root ops (5.3), Meta ops (6.6) — all `(Tree, CursorSet) → (Tree, CursorSet)`.
4. Unit tests for every op + fast-check property tests (no document grows error nodes after a successful mutation; cursors stay valid; Metas preserved).
5. CodeMirror adapter: applies an operation by computing the target text edit and dispatching it through CM's transaction API.
6. Cursor halo decoration; structural/insertion mode rendering; no-op flash.
7. Wire structural paradigm bindings (gamepad + keyboard) to call the new core.
8. Implement `hole` as a first-class core node kind (per `structural-editing.md §2.9`): tree-construction folds `($ <symbol> <:keyword>)` lists into `hole` leaves; structural ops treat them as atomic; `edit.fillHole` (§5.2.11) replaces a hole with content; `nav.nextHole` / `nav.prevHole` (§5.1.8) jump between unfilled holes.

### Phase B — Radial-menu data model and renderer

1. Define types and state machine (`src/lib/menu/types.ts`, `src/lib/menu/state.ts`): `MenuState` (single `open` variant with derived sub-phases), `Tab`, `Category`, `Item`, `Verb`, transitions.
2. JSON manifest schema and loader (`src/lib/menu/manifest.ts` + stub `manifest.json` — full content arrives via the manifest epic in parallel).
3. Pure state-machine tests: live tracking, sub-phase derivation, tab cycling, freeze entry/exit, hysteresis, edge cases (empty category, both shoulders).
4. fast-check property tests for the state machine (mirrors gamepad pipeline conventions).
5. New SVG renderer (`src/ui/menu/RadialMenu.tsx`) + adapter (`src/ui/adapters/radialMenu.ts`).
6. Centre breadcrumb + live preview component (CenterPanel.tsx) including the four-verb thumbnail strip.
7. Storybook stories for every sub-phase + frozen + auto-chain reopen.

### Phase C — Apply verbs and hole-aware insertion

1. Define the `apply` action vocabulary in the action registry (`src/lib/keybindings/actions.ts`): `menu.verb.insert`, `menu.verb.replace`, `menu.verb.wrap`, `menu.verb.call`, all marked reversible. Plus `menu.tab.cyclePrev`, `menu.tab.cycleNext`, `menu.cancel` (non-reversible).
2. Implement the four verbs against the structural-editing core. Each verb consumes `(MenuItem, CursorSet, Verb)` and produces a `(Tree, CursorSet)` mutation. `hand: 'both'` is a no-op flash.
3. Hole convention: holes are first-class core nodes from Phase A (`structural-editing.md §2.9`); structural ops treat them as atomic leaves; eval is per-form-gated on hole-presence (`code-evaluation.md §1.1`).
4. Auto-chain picker: when cursor lands on a hole post-apply, the dispatcher re-opens the menu with `leftTabIdx` and `leftHover` pre-selected from the hole's `:type`.
5. §8.5 special case: when the apply target is itself a hole, any verb fills the hole.
6. Pin-to-favorites store + persistence.
7. LT/RT pagination for overflowing right rings.

### Phase D — Integration

1. Replace the existing picker layer in `gamepad.md §6.5` with the radial-layer bindings (sticks → axis channels for ring cursors; LB/RB tap → tab cycle, press → freeze; face buttons → verbs in frozen; Back → cancel).
2. Enumerate and migrate every site that opens the old `DoubleRadialPicker`: snippet picker, function reference picker, `gamepadMenuBridge.ts`, the live-edit panel's gamepad bindings, and any other consumers found in audit. Each is its own bd issue.
3. Wire the Zen-mode implementation to mount the radial-menu adapter in exercise contexts (so practising users can reach the menu).
4. End-to-end browser test: a recorded gamepad timeline produces the expected document via the full pipeline.
5. Delete the old `DoubleRadialPicker`, `RadialMenu.tsx`, `pickerMenuModel.ts` files and `gamepadMenuBridge.ts`.
6. Update `gamepad.md`, `MAIN.md`, and `MAP.md` to reference the new menu and reflect the cleaned implementation. (No edits to `structural-editing.md` required — the `$` wrapper composes with the existing Metas system without spec changes; or add a one-line note at §6.2 if the wrapper deserves explicit mention.)

### Parallel — Manifest content authoring (its own beads epic)

Sub-issues per tab:
- Functions tab content: research uSEQ function library, write entries with signatures and category routing.
- Symbols tab content: curate common variable names list.
- Literals tab content: curate common numbers and keyword sets per context.
- Snippets tab content: write multi-token templates with typed holes.

Code phases ship with a stub of ~10 entries so the menu is testable from Phase B. The epic fleshes out the remainder; can be done in parallel with code work and does not gate Phase D.

## 7. Open questions and risks

7.1 **Hole convention.** ~~Decided as wrapper-Meta.~~ **Resolved**: holes are first-class structural nodes (`structural-editing.md §2.9`). Surface syntax `($ name :type)` is folded into a `hole` leaf at tree-construction time. The head symbol `$` is reserved at the parser level — no user-symbol footgun. Eval-gate is per top-level form, not per-document.

7.2 **Verb handedness for Wrap and Call.** Spec is committed (Wrap left/right swaps argument order; Call left/right is sibling-position). Real-world ergonomics may surprise; track in Phase D testing and refine the spec.

7.3 **Picker layer migration scope.** Phase D enumerates each consumer of the old `DoubleRadialPicker` as a separate bd issue. Total surface is roughly: snippet picker, function reference picker, `gamepadMenuBridge.ts`, live-edit panel gamepad bindings. Audit during Phase D kickoff to confirm completeness.

7.4 **Manifest content size.** ~40–100 entries with signatures and templates compresses to a small file. Target: ≤ 50 kB compressed. If exceeded, code-split or load-on-first-menu-open.

7.5 **Structural-editing implementation scope creep.** The clean rewrite is genuinely large. If Phase A overruns, the radial menu can ship against the existing structural code path with adapters; the rewrite continues in parallel. Don't gate menu progress on structural rewrite completion.

7.6 **First-time discoverability.** v1 ships without a tutorial overlay; Zen mode is the practice surface. Risk: walk-up users without Zen exposure miss the freeze mechanic. Idle-hint copy in the menu (§9.4) is the only in-context guidance. Re-evaluate after first user feedback.

7.7 **Eval-gate footgun.** Documents with holes cannot be evaluated. A user mid-chain who hits eval gets a friendly diagnostic — but a user who walked away mid-chain returns to a non-evaluable doc and may not understand why. Phase C should ensure the diagnostic is prominent (inline at the hole position + console toast).

7.8 **The `'both'` modifier.** Wired but no-op in v1. Risk: users discover "both" by accident, see no-op flash, and form a wrong mental model that "both is broken." Mitigation: the centre breadcrumb shows "reserved" explicitly when `shoulderHeld === 'both'`.

## 8. References

- `docs/specs/MAIN.md` — index of all specs
- `docs/specs/structural-editing.md` — the algebra
- `docs/specs/gamepad.md` — the input pipeline (and the picker layer being replaced)
- `docs/specs/gamepad-handoff.md` — current implementation status of the gamepad rebuild
- `docs/specs/live-edit.md` — live-edit knobs (numbers tab interplay)
- `docs/specs/zen-mode.md` — the practice/test surface
- `docs/specs/radial-menu.md` — the normative companion to this PRD (NEW, alongside this commit)

## 9. Decision log (from interview, 2026-05-01)

### Initial round

- **No-keyboard scope:** Pickers cover the common case; numpad and T9 sub-modes cover the long tail (digits, free text, new symbol coinage). Reinstated in v1 after the initial drop. See `radial-menu.md §14`.
- **Existing radial menu:** Replace entirely.
- **Extensibility model:** Per-context dynamic AND end-user pin-to-favorites at runtime. (No per-project presets, no full-reorder, no plugin packs in v1.)
- **Menu depth:** Two rings + LB/RB tabs at both ring levels.
- **Surface:** Centre-screen takeover.
- **Number entry:** Common numbers picker for the fast path; numpad sub-mode (`radial-menu.md §14`) for arbitrary values; post-commit `liveEdit.mark` for fine-tune. Numbers born as plain literals. (Originally in scope, then dropped, then reinstated as part of the pragmatic-completeness refinement.)
- **Structural ops in menu:** No — they stay on direct bindings. Menu is only for nouns.
- **Top-level tabs v1:** Functions, Symbols/vars, Literals (numbers + booleans + keywords), Snippets.
- **Apply verbs:** Insert (directional), Replace, Wrap (directional), Call (directional). Face button picks verb; LB/RB held provides handedness.
- **Open gesture:** `tap(Y)` leader, single-fire.
- **Centre UX:** Breadcrumb + live preview with four-verb thumbnails.
- **Snippet expansion:** Auto-chain pickers driven by typed holes.
- **Cursor outcome:** On the first hole if any, else on the inserted form.
- **Customisation v1:** Pin-to-favorites only.
- **Cancel:** Select/Back button. Inside `frozen`, Back is one-step-back to `picking`.
- **Spec packaging:** This PRD + a new `docs/specs/radial-menu.md`.

### Critical-review round (refinements)

- **Hole convention:** `($ name :type)` first-class core node kind (not `<name>` angle brackets, not a wrapper-Meta). Parses cleanly; folded to a `hole` leaf at tree construction; the `$` head is reserved at the parser level.
- **LB/RB dispatch:** Not dual-bound. Sub-phase determines role: tap-to-cycle in `cyclingLeftTabs`/`cyclingRightTabs`; press-to-freeze in `picking`. Sidesteps eager-with-undo entirely.
- **Stick state:** Live tracking, no locks. Sub-phase derived from current stick state. Only `frozen` is sticky.
- **Both-shoulders modifier:** Reserved no-op in v1 (`hand: 'both'`). Wired so the user discovers it; meaning is for v2.
- **First-run UX:** Zen mode is the discoverability surface. The Zen-mode spec doesn't need editing; the implementation needs to mount the menu adapter in Zen contexts.
- **Drill / soft alphabet:** Reinstated in v1 as the menu's numpad and T9 sub-modes (`radial-menu.md §14`). Phone-keypad polar layout on the left stick; face buttons append/commit/backspace/exit. Auto-chains directly into hole filling for `:number` and `:string` types.
- **Auto-chain cancel:** Leaves holes in document; user fills later by navigating to a hole and re-firing the menu.
- **LT/RT:** Analog scrub for paginating right ring when category overflows segment count.
- **Cursor halo:** Visible through dim, dimmed with rest of editor.
- **Manifest authoring:** Separate beads epic, parallel to code phases. Code ships with stub.
- **Engagement threshold:** 0.5 with hysteresis (~0.05).
