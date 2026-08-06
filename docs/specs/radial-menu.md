---
stability: evolving
layer: behavioural
---

# Radial menu

> Spec: ontology and algebra of the centre-screen, double-ring, gamepad-driven command surface for picking and applying nouns (functions, symbols, literals, snippets) into the document. Counterpart to [PRD.md](../../PRD.md).
>
> See also [structural-editing.md](structural-editing.md) (the algebra the apply verbs invoke), [gamepad.md](gamepad.md) (the input pipeline this menu rides on; the legacy picker layer in §6.5 is replaced by the radial layer specified here), [live-edit.md](live-edit.md) (numbers born from this menu can be promoted to live-edit knobs after-the-fact), [editor.md](editor.md) (the menu mounts above the main editor).
>
> This spec defines what the menu *means*. Concrete hardware-button assignments are inherited from [gamepad.md](gamepad.md)'s gesture vocabulary. Concrete item content is pulled from a bundled JSON manifest (§7).

### Source files

- `src/lib/menu/types.ts` — MenuTab, MenuItem, Verb, MenuState, HoleSpec
- `src/lib/menu/manifest.ts` / `manifest.json` — manifest loading, lint, cache
- `src/lib/menu/state.ts` — pure state machine reducer
- `src/lib/menu/verbs.ts` — verb implementations
- `src/lib/menu/chain.ts` — auto-chain runner
- `src/lib/menu/dispatcher.ts` — lifecycle/action routing adapter (impure)
- `src/lib/menu/textEntry.ts` — numpad/T9 layouts, hover state, and multi-tap timing
- `src/lib/menu/verbApplication.ts` — selection resolution and structural verb application
- `src/lib/menu/editorTarget.ts` — CodeMirror/structural-tree target and mutation adapter
- `src/lib/menu/chainCoordination.ts` — close/reopen input planning after a verb commit
- `src/lib/menu/store.ts` — Solid reactive store (menuStore)
- `src/ui/menu/RadialMenu.tsx` — SVG renderer (props-based)
- `src/ui/adapters/radialMenu.tsx` — imperative adapter (`mountRadialMenu`)
- `src/lib/gamepad/paradigms/radial.ts` — radial-menu paradigm layer (§11.3)
- `src/contracts/gamepadChannels.ts` — axis channels consumed by manual control
- `src/lib/keybindings/actions.ts` — `menu.*` action IDs (§11.4)

---

## 1. Frame

1.1 The radial menu is a **transient, full-takeover, gamepad-driven content picker**. While open, it is the user's primary interaction surface — the editor stays visible behind a dimmed backdrop and renders a live preview, but stick/button input goes to the menu, not the editor.

1.2 Its purpose is to let a performer insert *content* (functions, names, literals, snippets) into the document without a keyboard. **Verbs (slurp/barf/raise/enclose/transpose/navigation) stay on direct bindings** in the structural-editing layer — the menu does not host them. The menu's own verbs (Insert/Replace/WrapWith/Call) operate on content; structural verbs operate on shape.

1.3 The menu is a **first-class peer of the keyboard's "type a name" affordance**. Every menu commit produces a structural document edit identical in observable effect to having typed the same content with a keyboard.

1.4 The menu has **two rings** — left ring renders categories of the active left-tab; right ring renders items of the active right-tab. Rings are navigated by the two analogue sticks (left stick → left ring, right stick → right ring). LB/RB cycle tabs at the active ring level (§4).

1.5 The menu's lifecycle is **single-fire-leader**: a `tap(X)` opens it, the user makes one apply commit, the menu closes. Auto-chain (§8) re-opens the menu with a narrowed scope when an inserted form has typed holes.

1.6 Implementation is **driven by data**. The active manifest is a typed JSON document; the state machine is a pure function over `(MenuState, Input) → MenuState`. Hardware-free unit tests cover every transition, identical in style to the gamepad pipeline tests (gamepad.md §8).

1.7 Type safety is the priority. Tabs, categories, items, verbs, hole types, and apply outcomes are all statically typed. Adding a new tab or a new verb requires updating the literal-union types and the registry; impossible bindings (e.g. an `Insert` verb on a hole-only item) are rejected at compile time where possible, at manifest-load lint where not.

---

## 2. Ontology

### 2.1 Manifest types

```ts
// src/lib/menu/types.ts

type TabId = string             // branded; declared in the manifest
type CategoryId = string        // branded; unique within a tab
type ItemId = string            // branded; unique across the manifest

type MenuTab = {
  readonly id:    TabId
  readonly label: string
  readonly categories: readonly MenuCategory[]
  // optional sub-tabs of the right ring (cycled with LB/RB once a category is locked)
  readonly rightTabs?: readonly RightTab[]
}

type MenuCategory = {
  readonly id:     CategoryId
  readonly label:  string
  readonly icon?:  string                          // SVG ref or unicode glyph
  readonly items:  readonly MenuItem[]
}

type RightTab = {
  readonly id:     string
  readonly label:  string
  // a function over the locked left category's items, returning a filtered/reordered list
  readonly filter: (items: readonly MenuItem[], state: AppState) => readonly MenuItem[]
}

type MenuItem =
  | FunctionItem
  | SymbolItem
  | LiteralItem
  | SnippetItem

type FunctionItem = {
  readonly kind:      'function'
  readonly id:        ItemId
  readonly label:     string                       // display name
  readonly head:      string                       // the symbol inserted
  readonly signature?: ReadonlyArray<HoleSpec>     // typed holes for auto-chain
  readonly tags?:     readonly string[]
}

type SymbolItem = {
  readonly kind:  'symbol'
  readonly id:    ItemId
  readonly label: string                           // display name
  readonly text:  string                           // the bare symbol inserted
}

type LiteralItem = {
  readonly kind:    'literal'
  readonly id:      ItemId
  readonly label:   string
  readonly literal: number | boolean | string      // string = keyword w/o leading colon? see §7.4
  readonly literalKind: 'number' | 'boolean' | 'keyword'
}

type SnippetItem = {
  readonly kind:     'snippet'
  readonly id:       ItemId
  readonly label:    string
  readonly template: SnippetTemplate              // a tree fragment with named holes (§8.1)
}
```

### 2.2 Hole specs

```ts
type HoleSpec = {
  readonly name:    string                         // surfaces in source as `($ name :type)`
  readonly type:    HoleType
  readonly default?: unknown                       // sensible default if filled by `cancel-with-defaults` (deferred)
}

type HoleType =
  | 'number'        // auto-chain → Numpad sub-mode (§14) or Literals tab numbers category
  | 'symbol'        // auto-chain → Symbols tab; T9 sub-mode (§14) for new names
  | 'keyword'       // auto-chain → Literals tab, keywords category
  | 'expr'          // auto-chain → top-level (any tab); user picks
  | 'string'        // auto-chain → T9 sub-mode (§14)
```

`HoleType` mirrors the structural-editing kind set ([structural-editing.md §2.9](structural-editing.md)). Snippet authors may declare any of the five types; the manifest lint validates against this list.

### 2.3 Verbs

```ts
type Handedness = 'left' | 'right' | 'both'         // 'both' is reserved in v1 (no-op)

type Verb =
  | { kind: 'insert',   hand: Handedness }           // 'left' = sibling-before, 'right' = sibling-after
  | { kind: 'replace',  hand: Handedness }           // hand ignored in v1; reserved
  | { kind: 'wrapWith', hand: Handedness }           // 'left' = (picked target), 'right' = (target picked)
  | { kind: 'call',     hand: Handedness }           // 'left' = sibling-before, 'right' = sibling-after
```

Naming note: the menu's `wrapWith` verb is **distinct** from structural-editing's `enclose` op ([structural-editing.md §5.2.7](structural-editing.md)). `enclose` produces `(target)` — a bare-bracket wrap with an empty head. `wrapWith` produces `(picked target)` or `(target picked)` — the picked item participates in the new form. They are different operations and live in different action namespaces (`edit.enclose.*` vs `menu.verb.wrapWith`).

A verb fired with `hand: 'both'` is a no-op-flash in v1; the centre breadcrumb shows a "reserved" hint. The `'both'` slot is preserved to keep the verb shape stable while the eventual semantics are decided (see §13.4).

### 2.4 Menu state machine

The menu uses **live tracking** — the current selection is whatever the sticks point at right now, not a sticky lock. The phase is derived from stick state plus shoulder state:

```ts
type StickHover = number | null              // ring segment index, or null when stick centred (below threshold)

type MenuState =
  | { phase: 'closed' }
  | { phase: 'open',
      leftTabIdx:    number,
      rightTabIdx:   number,
      leftHover:     StickHover,
      rightHover:    StickHover,
      shoulderHeld:  ShoulderHeld,           // which shoulder(s) are currently held
      frozen:        FrozenSnapshot | null,  // latched picks captured when freeze entered
    }

type ShoulderHeld = 'none' | 'left' | 'right' | 'both'

type FrozenSnapshot = {
  readonly leftTabIdx:  number
  readonly leftPicked:  CategoryId          // the segment the left stick was on at freeze time
  readonly rightTabIdx: number
  readonly rightPicked: ItemId              // the item the right stick was on at freeze time
}
```

**Derived sub-phases** (informative — used by the renderer and dispatcher to decide LB/RB roles):

| Sub-phase | Condition |
|---|---|
| `cyclingLeftTabs` | `leftHover === null && rightHover === null && frozen === null` |
| `cyclingRightTabs` | `leftHover !== null && rightHover === null && frozen === null` |
| `picking` | `leftHover !== null && rightHover !== null && frozen === null` |
| `frozen` | `frozen !== null` |

The discriminator is `phase`; transitions are a pure function `(MenuState, MenuInput) → MenuState`. The state never references DOM, gamepad hardware, or live document — those live in the dispatcher (§11).

### 2.5 The manifest

The manifest is a single bundled JSON document. v1 schema:

```ts
type Manifest = {
  readonly version: 1
  readonly tabs:    readonly MenuTab[]
}
```

The manifest is loaded once at app boot, parsed, validated, and cached. There is exactly one active manifest in v1; pluggable sources, doc-derived providers, and per-project manifests are deferred (§13).

---

## 3. Lifecycle and surface

### 3.1 Opening

3.1.1 The menu opens on `tap(X)` (bound to `menu.radial` on the base/structural layer — see `src/lib/gamepad/paradigms/modal-shift.ts` and gamepad.md §6.1). Insertion mode is keyboard-only by intent ([structural-editing.md §4.2.1](structural-editing.md)); a gamepad-only user is never in insertion mode and the menu is always reachable. The open action sets `menuStore.open = true`; the **`radial-menu` layer** (`src/lib/gamepad/paradigms/radial.ts`) is a `when`-gated predicate layer that activates while the menu is open and masks all other gamepad input (§11.3, §12.6).

3.1.2 Initial `MenuState` is `{ phase: 'open', leftTabIdx: 0, rightTabIdx: 0, leftHover: null, rightHover: null, shoulderHeld: 'none', frozen: null }`. The first tab in the manifest is the default left tab.

3.1.3 The structural cursor's target at the moment the menu opens is captured into the menu's local context as the **apply target**. It is the static reference for verb application throughout the menu's open lifetime; structural-mode mutations from elsewhere cannot occur while the menu is open (input is masked).

3.1.4 `tap(X)` is the open gesture *only* on the base/structural layer. Once the menu is open, the radial layer takes over: `X` becomes the Replace verb and `Y` becomes the Wrap verb (§3.3) — there is no contention because the layers are mutually exclusive.

### 3.2 Surface

3.2.1 The menu is rendered as a centred SVG, ~480 px square (see `src/ui/RadialMenu.tsx`, `src/ui/DoubleRadialPicker.tsx`) (configurable via `menu.size` setting), with the editor behind it dimmed to ~30 % opacity. The dim layer is visually distinct from the picker dim today.

3.2.2 The two rings are concentric circles centred on the menu's centre. The left ring is on the **left half** of the SVG; the right ring on the **right half**. Each ring is a half-circle subdivided into segments matching the active tab's category/item count.

3.2.3 The **centre** is reserved for the breadcrumb + live preview (§9). It does not render menu items.

3.2.4 The active left-tab name is displayed at the top of the SVG (above both rings); the active right-tab name (when applicable) is displayed at the bottom.

3.2.5 Tab indicators (small dots or a bar) below each tab name show the tab index within the available tab set, so the user can see how many tabs to cycle through.

3.2.6 The structural cursor's halo on the editor remains rendered through the dim layer, dimmed at the same opacity as the rest of the editor. It gives the user spatial context for "where the change will land" alongside the centre's preview. No special brightening; the halo participates in the dim like the surrounding code.

3.2.7 Eval-result widgets, probe widgets, and live-edit knobs continue rendering and updating beneath the dim layer while the menu is open — they are presentation-only surfaces that do not consume input. Their visual prominence is the same as the rest of the editor (dimmed).

### 3.3 Input mapping

LB and RB are **never dual-bound to tap+hold**. Their meaning is fully determined by the current sub-phase (§2.4). This sidesteps the eager-with-undo machinery of `gamepad.md §5.2.2` entirely — every LB/RB press has exactly one role at the moment it fires.

While the radial layer is active, gamepad input is interpreted by sub-phase:

| Input | `cyclingLeftTabs` | `cyclingRightTabs` | `picking` | `frozen` |
|---|---|---|---|---|
| Left stick (axis) | drives `leftHover` (live) | drives `leftHover` (live; can return to centre) | drives `leftHover` (live) | ignored |
| Right stick (axis) | ignored (no item ring populated) | drives `rightHover` (live) | drives `rightHover` (live; can return to centre, dropping back to `cyclingRightTabs`) | ignored |
| LB tap | cycle left tab ← | cycle right tab ← | (no-op; `picking` uses LB/RB as press-modifiers only) | (LB already held — no-op) |
| RB tap | cycle left tab → | cycle right tab → | (no-op) | (RB already held — no-op) |
| LB press (held) | (no-op until phase transitions) | (no-op until phase transitions) | enter `frozen` with `shoulderHeld: 'left'`; `frozen` snapshot captures current hovers | held; verb fires on face-button press |
| RB press (held) | (no-op) | (no-op) | enter `frozen` with `shoulderHeld: 'right'` | held; verb fires on face-button press |
| LB+RB both held | — | — | enter `frozen` with `shoulderHeld: 'both'` | held; verb fires (with `'both'` modifier — reserved no-op in v1) |
| LT / RT (analog) | — | scroll/paginate the right ring's items if the locked category overflows the ring's segment count (§4.4) | same as `cyclingRightTabs` | (no-op) |
| Face A | (no-op in pick phases) | (no-op) | (no-op) | verb: Insert (hand from `shoulderHeld`) |
| Face X | (no-op) | (no-op) | (no-op) | verb: Replace (hand reserved) |
| Face Y | (no-op) | (no-op) | (no-op) | verb: WrapWith (hand from `shoulderHeld`) |
| Face B | (no-op) | (no-op) | (no-op) | verb: Call (hand from `shoulderHeld`) |
| Back | close menu | close menu | close menu | release `frozen` and return to `picking` (one-step back) |

3.3.1 **Live tracking.** Hover indices follow the stick continuously. There is no "lock" — moving the stick to a new segment immediately replaces the hover; returning to centre clears it. This makes phase transitions automatic: stop touching a stick → drop down a sub-phase. The **only** sticky state in the open menu is the `frozen` snapshot.

3.3.2 **Freeze trigger.** A shoulder press while in `picking` (both hovers non-null) latches a `FrozenSnapshot` of the current hovers and records `shoulderHeld`. Once frozen, sticks may release; the snapshot remains. Releasing all shoulders without a face press returns to `picking` (`frozen` cleared; live hovers resume tracking the sticks).

3.3.3 **Freeze requires both hovers.** If either `leftHover` or `rightHover` is `null`, a shoulder press is a no-op (the freeze trigger is suppressed). Visually, the freeze affordance is greyed out until both rings have a live hover.

3.3.4 **Phase transition mid-press.** A shoulder pressed during `cyclingLeftTabs` or `cyclingRightTabs` (where it normally cycles tabs on tap) does *not* carry over its press into a freeze if the user subsequently engages the missing stick. The shoulder must be released and re-pressed in `picking` to trigger freeze. This is enforced by the dispatcher tracking shoulder presses per-sub-phase: a press is "owned" by the sub-phase it began in.

3.3.5 **The "both" modifier.** Holding LB and RB together in `picking` enters `frozen` with `shoulderHeld: 'both'`. Face buttons in this state fire their verbs with `hand: 'both'`, which produces a no-op flash in v1. The mechanic is wired so the user discovers the modifier exists; meaningful behaviour is added in a future version (§13.4).

3.3.6 **Back semantics.** Outside `frozen`, Back closes the menu. Inside `frozen`, Back is a *one-step-back*: clear the frozen snapshot and return to `picking` (sticks resume live tracking from their current positions). This lets the user reconsider an item without closing the menu.

### 3.4 Closing

The menu closes on:
- Successful verb dispatch (a face-button press in `frozen`), unless auto-chain (§8) requires a re-open.
- Back / Select pressed at any pick phase.
- The user leaving the gamepad's connected state (gamepad disconnect → close + cancel).
- An out-of-band close gesture from elsewhere (e.g. keyboard `Esc`) — possible but rare, since the menu is gamepad-only by design.

On close, the radial-menu transient layer is popped, `menuStore.open = false`, and the structural cursor returns to its position post-mutation (or the original target on cancel). (see `src/ui/adapters/gamepadMenuBridge.ts` for current close handling)

---

## 4. Tabs and rings

### 4.1 Tabs at the left ring

4.1.1 Top-level tabs are declared in `manifest.tabs`. v1 ships with these four:

| ID | Label | Contents |
|---|---|---|
| `functions` | Functions | The language's built-in callable forms, bucketed into categories (Math, Audio, Control, Lists, Time, IO). |
| `symbols` | Symbols | Curated common variable names (`x`, `i`, `t`, `phase`, `freq`, `cutoff`, `bpm`…). v1 has no soft-alphabet escape hatch; new symbol names require a keyboard. |
| `literals` | Numbers/KW | Common numbers (small ints, durations, ratios, audio rates), booleans, common keywords. v1 has no digit-by-digit drill; arbitrary numbers require a keyboard. |
| `snippets` | Snippets | Multi-token templates such as `(slow N body)`, `(osc freq)`, common patterns. |

4.1.2 Tabs cycle on LB/RB tap when the menu is in sub-phase `cyclingLeftTabs` (both sticks centred). To cycle left tabs without closing the menu, the user briefly returns both sticks to centre, taps LB/RB, then re-engages.

4.1.3 When a left tab is cycled, the right tab index resets to `0` for the new tab. Hovers (`leftHover`, `rightHover`) are already `null` by virtue of being in `cyclingLeftTabs`.

### 4.2 Tabs at the right ring

4.2.1 Each `MenuTab` MAY declare `rightTabs: RightTab[]`. These are filter-views on the items of whichever category is currently hovered by the left stick. v1 use cases:

- For `functions`: `[All, Favorites, Recent]` — Favorites = pinned, Recent = last 10 used.
- For `symbols`: `[Common]` — single view in v1; the structure supports more.
- For `literals`: `[Numbers, Booleans, Keywords]` — segregated by literal kind.
- For `snippets`: `[All, Favorites]`.

4.2.2 Right-tab cycling activates in sub-phase `cyclingRightTabs` (left stick engaged, right stick centred). LB/RB taps cycle right tabs while in this sub-phase.

4.2.3 When the right tab changes, the right ring's items repopulate immediately. The right hover (if any when the user re-engages) is computed against the new ring's segment count.

### 4.3 Live tracking

4.3.1 The menu does **not** lock category or item picks. Hover indices are computed live from the current stick state on every poll: any stick component below the engagement threshold (default 0.5) yields `null`; above threshold, the polar angle is mapped to the nearest segment.

4.3.2 Sub-phase transitions follow stick state directly. Letting either stick return to centre transitions the menu down a sub-phase (from `picking` → `cyclingRightTabs`, or `cyclingRightTabs` → `cyclingLeftTabs`). Re-engaging the stick transitions back up.

4.3.3 The only **sticky** state in the open menu is `frozen` (the latched snapshot, captured when a shoulder is pressed in `picking`). Sticks may release or wander after freeze; the snapshot ignores them.

### 4.4 Right-ring pagination (LT/RT)

4.4.1 If a right-tab's filtered items exceed the ring's segment count (default ~12 segments at standard size), the right ring renders a single **page** of items. LT and RT scroll the page in either direction:
- LT held: each tick (by sustained pressure or by re-engagement) advances the page index by one segment-stride toward the start of the list.
- RT held: same toward the end.

4.4.2 Pagination is animated; the centre of the menu shows a small "page N/M" indicator. Pages cycle (last → first) so the list is endless from the user's perspective.

4.4.3 If the filtered list fits in one ring, LT/RT are no-ops (and the right ring visually has no pagination indicator).

4.4.4 LT/RT operate identically in `cyclingRightTabs` and `picking`. They are no-ops in `cyclingLeftTabs` and `frozen`.

### 4.5 Engagement threshold

The default engagement threshold is `0.5` magnitude — chosen as the midpoint between the gamepad pipeline's deadzone (0.12 per gamepad.md §3.3.2) and flick threshold (0.7 per gamepad.md §3.2.6). This gives the user clear haptic feedback that a hover commits without forcing a hard flick. The threshold is settable via `menu.stickEngagement` (default `0.5`, min `0.2`, max `0.9`). Hysteresis (~0.05) is applied so a stick at exactly threshold does not chatter between hover and centred.

---

## 5. Apply verbs

### 5.1 Verb semantics

Each verb is an action over `(Tree, CursorSet, MenuItem) → (Tree, CursorSet)`. The cursor target at menu-open is the apply target for all verbs.

5.1.1 **Insert** (face A). The picked item's representation is inserted as a sibling of the apply target.
- `hand: 'left'` (LB held): inserts as the immediately-prior sibling (sibling-before).
- `hand: 'right'` (RB held): inserts as the immediately-next sibling (sibling-after).
- `hand: 'both'` (both held): no-op flash (reserved).
- **Document-root special case.** When the apply target is the document root (typically: empty document, or cursor escaped to root via `nav.out`), Insert appends the picked item as the **last top-level child**, regardless of handedness. This is the canonical first-interaction path for an empty-document gamepad session. `Wrap`, `wrapWith`, and `Call` against the document root remain no-op-flash (no enclosing form exists to operate on); see §5.1.2 for `Replace` at root.
- Cursor moves to the inserted node, or to its first hole if any (§5.4).
- For function items: the inserted form is `(head ($ hole-1 :type) ($ hole-2 :type) …)`, where hole names and types come from `signature` (§8 hole convention).
- For symbol items: the inserted node is the bare symbol.
- For literal items: the inserted node is the literal.
- For snippet items: the inserted node is the snippet's tree fragment with all holes intact.

5.1.2 **Replace** (face X). The apply target is replaced wholesale with the picked item's representation.
- Handedness ignored in v1; reserved for future variants.
- `hand: 'both'` is a no-op flash.
- Cursor moves to the replaced node, or to its first hole if any.
- If the apply target is the document root, the entire document is replaced — issue a no-op flash unless the picked item is itself a top-level form.

5.1.3 **WrapWith** (face Y). The apply target is enclosed in a new compound in which the picked item participates as a sibling. (Distinct from structural-editing's `enclose` — see §2.3 naming note.)
- `hand: 'left'`: produces `(picked target)` — picked is the head; target is the first child.
- `hand: 'right'`: produces `(target picked)` — target is the head; picked is the first child.
- `hand: 'both'`: no-op flash (reserved).
- Cursor moves to the new compound, or to its first hole if any.
- For function items, holes from `signature` are inserted *after* the relevant participant; e.g. `hand: 'left'` on `osc` (signature `[($ freq :number)]`) wrapping target `440` produces `(osc 440)` — the wrap consumed the freq hole.

5.1.4 **Call** (face B). Similar to Wrap but the apply target is *not* a child — it's a sibling of a fresh call form.
- `hand: 'left'`: inserts `(picked ($ hole-1 :type) …)` as the sibling-before of the apply target.
- `hand: 'right'`: inserts `(picked ($ hole-1 :type) …)` as the sibling-after.
- `hand: 'both'`: no-op flash (reserved).
- Cursor moves to the new call form's first hole.
- Distinct from Insert in that Insert inserts the bare item (a symbol, a literal); Call always wraps in a call form even if the item is a function with no signature (in which case the form is `(picked)` with cursor on the form itself).

### 5.2 Verb reversibility

All four verbs are **reversible** per [gamepad.md §5.1](gamepad.md). They are added to `reversibleActions` in the action registry. With the contextual LB/RB scheme (§3.3) the dispatcher does not actually need eager-with-undo for menu operations — but reversibility is preserved as the canonical classification because (a) `editor.undo` after a verb commit must restore the pre-menu document state, and (b) future verb variants may invoke eager-with-undo dispatch.

### 5.3 Invalid combinations

Some verb–item pairs produce nonsensical structures (e.g. Wrap on a numeric item: `(42 target)`). v1 policy:
- The verb runs and produces the structurally-valid (if semantically broken) tree.
- The breadcrumb (§9) renders the *predicted* result; the user sees `(42 target)` in the preview before pressing Y.
- A linter pass over the post-mutation tree may surface a soft warning, but does not block the action.

This is consistent with the structural-editing spec's policy: structural ops produce well-formed trees; semantic validity is the user's responsibility.

### 5.4 First-hole-or-form rule

After a verb commits, the cursor lands on the **first unfilled hole** of the inserted/wrapped/replaced node, if any exists. Otherwise on the node itself.

A "hole" is a node matching the placeholder convention (§8.1). Cursor placement after apply is computed by the verb implementation, not by the menu.

---

## 6. State machine transitions

### 6.1 Transition table (informative)

`MenuInput` events come from the dispatcher: stick polls produce `axisLeft(hover)` / `axisRight(hover)` (where `hover` is `number | null`); shoulder polls produce `shoulderEdge(LB|RB|both, 'press' | 'release')`; face buttons produce `face(A|X|Y|B)`; back produces `back`.

```
closed
  ─ tap(X) ─→  open(t=0, rt=0, lh=null, rh=null, sh='none', frozen=null)

open(t, rt, lh, rh, sh, frozen)  with derived sub-phase from (lh, rh, frozen)

  -- live tracking (always live, regardless of sub-phase except 'frozen')
  ─ axisLeft(h')   when frozen=null  ─→  open(t, rt, h', rh, sh, null)
  ─ axisRight(h')  when frozen=null  ─→  open(t, rt, lh, h', sh, null)

  -- tab cycling (sub-phase-gated)
  ─ tap(LB) when sub-phase = cyclingLeftTabs   ─→  open(t-1 mod N, 0, null, null, 'none', null)
  ─ tap(RB) when sub-phase = cyclingLeftTabs   ─→  open(t+1 mod N, 0, null, null, 'none', null)
  ─ tap(LB) when sub-phase = cyclingRightTabs  ─→  open(t,    rt-1 mod M, lh, null, 'none', null)
  ─ tap(RB) when sub-phase = cyclingRightTabs  ─→  open(t,    rt+1 mod M, lh, null, 'none', null)

  -- pagination (sub-phase-gated)
  ─ trigger(LT|RT) when sub-phase ∈ {cyclingRightTabs, picking}  ─→  page-shift right ring

  -- freeze entry (sub-phase = picking)
  ─ shoulderEdge(LB,'press')   when sub-phase=picking ─→  open(t, rt, lh, rh, 'left',  snapshot(t, lh, rt, rh))
  ─ shoulderEdge(RB,'press')   when sub-phase=picking ─→  open(t, rt, lh, rh, 'right', snapshot(t, lh, rt, rh))
  ─ shoulderEdge(both,'press') when sub-phase=picking ─→  open(t, rt, lh, rh, 'both',  snapshot(t, lh, rt, rh))

  -- frozen
  ─ shoulderEdge(_, 'release-all')  when sub-phase=frozen  ─→  open(t, rt, lh, rh, 'none', null)
  ─ face(F)                         when sub-phase=frozen  ─→  closed; dispatch verb(F, sh) on (target, frozen.item)
  ─ back                            when sub-phase=frozen  ─→  open(t, rt, lh, rh, 'none', null)

  ─ back  (any other sub-phase) ─→  closed
```

`snapshot(t, lh, rt, rh)` builds a `FrozenSnapshot` resolving the hover indices into concrete `CategoryId` and `ItemId` against the active manifest.

### 6.2 Edge cases

6.2.1 **Empty category.** If the hovered category has zero items, the right ring renders a "no items" placeholder. The right stick can engage but `rightHover` will always be `null` (no segments). Freeze is impossible (3.3.3). User cycles left tabs or hovers a different category.

6.2.2 **Single-item category.** Right ring is a single full segment; any right-stick engagement past threshold hovers it. Freeze proceeds normally.

6.2.3 **Tab cycle wraps.** Tabs cycle modulo the count. The tab indicator (§3.2.5) shows the current tab's position so the user can sense wrap.

6.2.4 **Stick chatter at threshold.** Hysteresis (§4.5) prevents oscillation between hover and centred when a stick rests exactly at the engagement threshold. Without it, a fingertip resting on the stick at ~0.5 magnitude could rapid-fire phase transitions.

6.2.5 **Both shoulders pressed simultaneously near in time.** If LB and RB presses arrive within `T_bothWindow` (default 25 ms), they are coalesced into a single `shoulderEdge(both, 'press')` event. Outside the window, the second press updates `shoulderHeld` from `'left'` → `'both'` (or `'right'` → `'both'`); a release of one then drops back to the still-held shoulder's value.

---

## 7. The manifest

### 7.1 Source of truth

The v1 manifest is a single TypeScript-validated JSON file at `src/lib/menu/manifest.json`, validated against the types in §2 at compile time (via a generated zod-or-similar schema) and at runtime (parsed once on app boot).

### 7.2 Lint

The manifest must satisfy:
- Tab IDs are unique within `manifest.tabs`.
- Category IDs are unique within their tab.
- Item IDs are unique across the whole manifest.
- Hole names within a single signature are unique.
- Hole types are valid (one of `'number' | 'symbol' | 'keyword' | 'expr'`). v1 rejects `'string'` (no soft alphabet).
- Snippet templates that reference holes only reference holes declared in the same template.
- A function item with a `signature` MUST list each hole exactly once.

The lint runs at app boot with descriptive errors; failed lint disables the menu (with a console warning) but does not crash the app.

### 7.3 Curated content for v1

The v1 manifest is authored as a **separate piece of work** from the code (see PRD.md §6 — "Curate v1 manifest content" is its own beads epic). Code phases ship with a stub manifest of ~10 entries to make the menu testable; the epic fleshes out the full content listed below.

7.3.1 **Functions tab.** Categories: Math (`+`, `-`, `*`, `/`, `mod`, `floor`, `ceil`, `round`, `abs`, `min`, `max`, `pow`, `sqrt`, `sin`, `cos`, `tan`), Audio (`osc`, `phasor`, `noise`, `svf`), Control (`if`, `cond`, `let`, `define`, `defn`, `do`, `when`), Lists (`map`, `filter`, `reduce`, `range`, `concat`, `first`, `rest`, `nth`), Time (`slow`, `fast`, `every`, `at`, `delay`), IO (`print`, `dbg`, `out`).

Each entry has its label (= head), tags (used for category routing), and a `signature` array if it's known.

7.3.2 **Symbols tab.** A single category Common (`x`, `i`, `j`, `n`, `t`, `phase`, `freq`, `cutoff`, `gain`, `bpm`, `dur`, `step`). v1 has no soft-alphabet escape hatch — coining brand-new symbol names mid-session requires a keyboard.

7.3.3 **Literals tab.** Categories:
- Numbers: bucketed into Small ints (`0`, `1`, `2`, `3`, `4`, `8`, `16`), Common (`-1`, `0.5`, `0.25`, `0.75`, `100`, `120`, `1000`), Audio rates (`44100`, `22050`, `48000`, `60`). v1 has no digit-by-digit drill — values not in the curated list require a keyboard or post-commit `liveEdit.mark` to dial.
- Booleans: `true`, `false`.
- Keywords: a context-aware list — when the cursor's enclosing form's head matches a known wrapper (e.g. `live-edit`), this category is dynamically populated from the wrapper's known keys (`:id`, `:min`, `:max`, `:step`, `:precision`, `:options`, `:name`). Otherwise a generic list of common keywords.

7.3.4 **Snippets tab.** Categories: Time (`(slow ($ rate :number) ($ body :expr))`, `(fast ($ rate :number) ($ body :expr))`, `(every ($ n :number) ($ body :expr))`), Audio (`(osc ($ freq :number))`, `(phasor ($ freq :number))`), Control (`(if ($ cond :expr) ($ then :expr) ($ else :expr))`, `(let [($ name :symbol) ($ value :expr)] ($ body :expr))`, `(when ($ cond :expr) ($ body :expr))`).

The exact item lists evolve; the manifest is the single source of truth and changes go there.

### 7.4 Keyword representation

Keyword literals in source begin with a leading `:` (`:up`, `:down`). The manifest encodes the *bare name* (`up`, `down`) as a string and the loader prefixes with `:` at insertion time.

---

## 8. Auto-chain pickers

### 8.1 The hole convention

8.1.1 Holes are **first-class structural nodes** per [structural-editing.md §2.9](structural-editing.md). Their surface syntax is `($ name :type)`; their internal representation is a `hole` leaf with core fields `(name, type)`. The menu's auto-chain, eval-gate, and fold rendering all key off the `hole` node kind directly — there is no menu-private hole concept.

```lisp
(osc ($ freq :number))
(slow ($ rate :number) ($ body :expr))
```

8.1.2 The head symbol `$` is reserved at the parser level ([structural-editing.md §2.9.1](structural-editing.md)). A list whose head is `$` and whose shape matches `($ <symbol> <:keyword>)` is folded into a `hole` leaf at tree-construction time; structural ops (slurp, raise, transpose, enclose, wrapWith) treat the hole as a single atomic unit per [structural-editing.md §2.9.2](structural-editing.md).

8.1.3 Holes are foldable, default folded — they render as inline placeholder pills (e.g. `⟨freq⟩`). Cursor halos render around the pill; the source `($ freq :number)` becomes visible only when unfolded (e.g. via `mode.insert` from a keyboard). See [structural-editing.md §2.9.5](structural-editing.md).

8.1.4 **Holes block evaluation per top-level form.** A top-level form whose subtree contains a `hole` leaf is rejected at eval submission; sibling top-level forms without holes evaluate normally. The unfilled-hole diagnostic is rendered inline at the hole position. See [structural-editing.md §2.9.3](structural-editing.md) and [code-evaluation.md §1.1](code-evaluation.md). The gate is per-form, not per-document — incremental live coding (eval one form, leave another mid-construction) is preserved.

8.1.5 **The runtime fallback.** If a holey form somehow reaches the runtime (e.g. a hand-edited document bypassing the editor's eval gate), the runtime treats `$` as an unknown function and fails with a normal compile error, falling back to LKG per [MAIN.md §2.1](MAIN.md). Holes do not crash the runtime.

### 8.2 Chain logic

8.2.1 After a verb commits and the cursor lands on a hole, the menu re-opens automatically with a narrowed scope based on the hole's `:type`:

| Hole `:type` | Re-open scope | Auto-open in chain? |
|---|---|---|
| `:number` | `leftTabIdx = literals`, enters numpad sub-mode directly (§15.1.2) | yes (instant) |
| `:string` | enters T9 sub-mode directly (§15.1.2) | yes (instant) |
| `:keyword` | `leftTabIdx = literals`, hover pre-selected to `keywords` category | yes (instant) |
| `:symbol` | `leftTabIdx = symbols` | yes (instant) |
| `:expr` | `leftTabIdx = 0` (Functions); user picks any tab | **no — chain pauses** |
| (none / unknown) | `leftTabIdx = 0`; user picks any tab | **no — chain pauses** |

The pre-selected hover is set into `leftHover` so the user just engages the right stick to start picking. To override the pre-selection they can release the left stick and re-engage on a different category.

The two no-auto-open rows above realise the carve-out specified in [structural-editing.md §2.9.9](structural-editing.md): for holes with no narrowing scope, opening a wide menu without user intent costs more than it saves. The chain pauses on those holes; the cursor sits on the pill (with halo); the user taps `X` to summon the menu when ready, and chain resumes on the *next* hole the commit lands the cursor on.

8.2.2 The chain continues until either no more holes remain on the inserted form or the user cancels (Back). On cancel, **remaining holes stay in the document**. The user can fill them later by navigating to a hole and pressing `tap(X)` to re-summon the menu — a hole as the apply target re-opens the menu with the same narrowed scope. Manual navigation onto a hole (via `nav.nextHole` / `nav.prevHole` / arrow nav) **never** auto-opens the menu, even for typed holes; the user always taps `X` to summon it. See [structural-editing.md §2.9.9](structural-editing.md).

8.2.3 Each chain step is a separate, undoable mutation on the document. The user can `editor.undo` to step back through the chain.

### 8.3 Multiple holes in scope

If an inserted form has multiple holes, the cursor lands on the **first** (document order). Subsequent holes are filled one at a time, in the order the cursor visits them.

The chain runner moves the cursor to the next hole automatically after each commit. If no more holes are unfilled in the originally-inserted form, the chain ends and cursor lands on the *form* itself (the rule from §5.4).

### 8.4 Snippet templates

A snippet's `template` is a tree fragment with embedded `($ name :type)` holes. Example:

```ts
const slowSnippet: SnippetItem = {
  kind: 'snippet',
  id: 'snip-slow',
  label: '(slow N body)',
  template: parseTemplate('(slow ($ rate :number) ($ body :expr))'),
}
```

The `parseTemplate` helper recognises the `($ name :type)` syntax, producing a tree fragment with typed holes ready for chain. The template is plain Clojure source.

### 8.5 Filling a hole as the apply target

When the apply target *is itself a hole* (cursor on a hole, user invokes any verb), the verb dispatches `edit.fillHole` ([structural-editing.md §5.2.11](structural-editing.md)) regardless of which face was pressed (Insert, Replace, WrapWith, or Call) — the user's intent is unambiguously "fill this hole." Handedness is ignored. This makes the auto-chain experience uniform: the user does not have to remember to use Replace specifically. The picked item's representation (with its own holes intact, if a snippet) replaces the hole; cursor lands on the inserted content's first hole if any, or on the inserted content itself per §5.4.

---

## 9. Centre breadcrumb and live preview

### 9.1 Pick phases

In `cyclingLeftTabs`: centre shows the active left-tab name, large and bold. No preview yet.

In `cyclingRightTabs`: centre shows breadcrumb `<TabName> ▸ <CategoryName>`, where `<CategoryName>` is whatever the left stick currently hovers (or "—" if no hover). Active right-tab name displayed below.

In `picking`: centre shows breadcrumb `<TabName> ▸ <CategoryName>` plus the hovered item's label below the breadcrumb in a smaller font.

### 9.2 Frozen phase

In `frozen`: centre shows:
- Top: breadcrumb `<TabName> ▸ <CategoryName> ▸ <ItemLabel>`.
- Middle: a **live preview** of the document with the proposed mutation rendered in a different colour. The preview re-renders as the `shoulderHeld` value changes (LB vs RB vs both); the verb selection is committed only on face-button press, so the preview shows the current item's predicted insertion across all four verbs as small thumbnails (one per verb).
- Bottom: a verb-hint row: `[A] Insert  [X] Replace  [Y] WrapWith  [B] Call`. Each verb hint annotates handedness (e.g. `[A] Insert ←` when `shoulderHeld === 'left'`).

The preview does NOT modify the underlying document. It is rendered in the centre of the menu (the dimmed editor remains untouched).

### 9.3 Auto-chain mode indicator

When the menu re-opens via auto-chain, a small "↻" glyph appears next to the breadcrumb, plus a hole-name hint (e.g. `↻ filling ⟨freq⟩`) so the user understands which hole they're filling.

### 9.4 No-input idle

If no input arrives for 5 seconds in any pick sub-phase, the centre fades a hint:
- `cyclingLeftTabs`: "Stick to navigate · LB/RB cycle tabs · Back to close"
- `cyclingRightTabs`: "Right stick to pick item · LB/RB cycle right tabs"
- `picking`: "Hold LB or RB to freeze · then face button = verb"
Dismissed by any input.

---

## 10. First-run discoverability

10.1 The menu's freeze + handedness mechanic is novel; new users will not discover it by accident. v1 relies on **Zen mode** (per [zen-mode.md](zen-mode.md)) as the canonical practice/tutorial surface — Zen exercises naturally exercise the menu where their target action is best invoked through it.

10.2 This spec does NOT prescribe specific Zen-mode exercises. The Zen mode spec is concerned with the practice environment itself (grid, prompts, validation); how individual exercises invoke the editor (keyboard, gamepad, menu) is part of the editor's surfaces and not its concern.

10.3 The Zen mode **implementation** must be able to mount the radial menu adapter when an exercise is loaded, so a user practising slurp/barf may also reach for the menu. This is a wiring task in Phase D, not a spec edit.

10.4 Beyond Zen, v1 ships no first-run overlay. The §9.4 idle hints are the only in-menu guidance. Discoverability through Zen + idle hints is the v1 bet.

---

## 11. Implementation

### 11.1 File layout

```
src/lib/menu/
  types.ts               // MenuTab, MenuCategory, MenuItem, Verb, MenuState, HoleSpec, HoleType
  manifest.ts            // load, lint, cache the JSON manifest
  manifest.json          // v1 curated content (stub initially, fleshed out via the manifest epic)
  state.ts               // pure state machine: reducer (state, input) → state
  verbs.ts               // pure verb implementations: (Tree, CursorSet, MenuItem, Verb) → (Tree, CursorSet)
  chain.ts               // auto-chain runner: detects holes, schedules next-pick
  chainCoordination.ts   // translates a post-verb chain result into close/reopen reducer inputs
  textEntry.ts           // numpad/T9 layouts plus hover and multi-tap timing
  verbApplication.ts     // resolves a frozen selection and applies one structural verb
  editorTarget.ts        // CodeMirror/structural target lookup and source mutation
  templates.ts           // parseTemplate(str) → snippet tree fragment with holes
  store.ts               // Solid reactive store (menuStore.open, current MenuState, current target, …)
  dispatcher.ts          // wires lifecycle and high-level actions across the focused modules

src/lib/menu/state.test.ts
src/lib/menu/verbs.test.ts
src/lib/menu/chain.test.ts
src/lib/menu/manifest.test.ts
src/lib/menu/state.property.test.ts   // fast-check property tests (mirrors gamepad pipeline)

src/ui/menu/
  RadialMenu.tsx         // SVG renderer, props-based; subscribes to menuStore
  CenterPanel.tsx        // breadcrumb + preview
  menu.css

src/ui/adapters/
  radialMenu.ts          // mountRadialMenu(), open(), close() imperative API
```

Files dropped from the original outline (now deferred): `alphabet.ts`, `drill.ts`, `AlphabetRing.tsx`, `DrillRing.tsx`.

### 11.2 The dispatcher (`src/lib/menu/dispatcher.ts`)

The dispatcher is the menu's lifecycle and high-level action adapter. It:
- Subscribes to the gamepad's `radial-menu` transient layer's actions and axis channels.
- Translates input into state-machine events.
- Dispatches typed `MenuInput` values through the injected store bridge, whose reducer computes the next state.
- Delegates numpad/T9 hover and multi-tap state to `textEntry.ts`.
- Delegates frozen-selection resolution and structural mutation to `verbApplication.ts`, whose CodeMirror boundary is isolated in `editorTarget.ts`.
- Dispatches the close/reopen reducer inputs planned by `chainCoordination.ts` after a successful verb commit.

This keeps impurity explicit without making one module own every concern: the dispatcher owns subscriptions and ordering, text entry owns its timer, and the editor adapter owns source mutation.

### 11.3 Picker layer (gamepad.md §6.5) replacement (current: `src/lib/gamepad/paradigms/picker.ts`)

The new radial layer in the gamepad pipeline replaces the existing picker layer. Bindings are registered as a transient layer in the gamepad paradigm files (or as a permanent layer with `when: state => menuStore.open`).

```ts
// src/lib/gamepad/paradigms/radial.ts
const radialLayer: Layer = {
  name: 'radial-menu',
  when: state => state.menu.open,
  gestures: {
    // LB/RB: tap = tab cycle (sub-phase-conditional in dispatcher); press = freeze trigger.
    // The recognizer always emits both tap and held; the dispatcher decides which to honour.
    [keyOf(tap('LB'))]:    'menu.tab.cyclePrev',
    [keyOf(tap('RB'))]:    'menu.tab.cycleNext',
    [keyOf(tap('A'))]:     'menu.verb.insert',
    [keyOf(tap('X'))]:     'menu.verb.replace',
    [keyOf(tap('Y'))]:     'menu.verb.wrapWith',
    [keyOf(tap('B'))]:     'menu.verb.call',
    [keyOf(tap('Back'))]:  'menu.cancel',
  },
  axes: {
    left:  'menu.left.angle',
    right: 'menu.right.angle',
  },
  // Full input takeover (§1.1, §12.6). The radial layer is a `when`-gated
  // predicate layer (not a transient push), so `onMiss` alone is inert — the
  // resolver only honours `onMiss` for transient layers. `mask: true` makes the
  // resolver discard any gesture this layer does not bind (e.g. D-pad) while
  // the menu is open, instead of leaking it to the editor's base layer.
  mask: true,
  onMiss: 'pop-and-discard',
}
```

The dispatcher consults the current `MenuState.shoulderHeld` (computed from raw shoulder press/release events on every poll) to determine sub-phase. The verb actions read `MenuState.frozen.shoulderHeld` (the latched handedness) when computing the verb's `hand` argument. Tab-cycle actions are no-ops when the current sub-phase is not `cyclingLeftTabs` or `cyclingRightTabs` (so a stray LB tap inside `picking` or `frozen` is silently dropped).

### 11.4 The action registry (see `src/lib/keybindings/actions.ts`)

New `ActionId`s registered:

```ts
'menu.tab.cyclePrev'    // non-reversible (UI state)
'menu.tab.cycleNext'    // non-reversible
'menu.verb.insert'      // reversible
'menu.verb.replace'     // reversible
'menu.verb.wrapWith'    // reversible (distinct from edit.enclose.* — see §2.3 / §5.1.3)
'menu.verb.call'        // reversible
'menu.text.open'        // non-reversible (opens text-entry sub-mode, §14)
'menu.cancel'           // non-reversible
```

These are added to `src/lib/keybindings/actions.ts`. Note: there are no `menu.freeze.*` actions — freeze is a state transition triggered by raw shoulder press/release events handled by the dispatcher directly, not a user-visible action. The action registry is for things a user might bind on the keyboard or rebind on the gamepad; freeze is intrinsic to the menu's input handling.

### 11.5 Performance budgets

- **Cold open (`tap(X)` to first frame painted):** ≤ 80 ms target, ≤ 150 ms max. The menu's first frame must include the active left tab and any pre-selected hover.
- **Sub-phase transition rendering:** ≤ 16 ms per transition (one animation frame).
- **Live preview re-render on `shoulderHeld` change:** ≤ 16 ms. Preview thumbnail computation must be cached per `(item, verb)` pair so changing handedness doesn't re-parse the predicted insertion.
- **Auto-chain reopen (verb commit to next menu's first frame):** ≤ 100 ms. This includes the document mutation, hole detection, and menu re-paint.

---

## 12. Failure modes

12.1 **Apply target invalid.** If the cursor target at menu-open is the document root and the picked item is not a valid top-level form (e.g. a bare keyword), the verb produces a no-op flash and the menu closes without mutation.

12.2 **Manifest fails to load or lint.** Menu is disabled; `tap(X)` is a no-op-flash with a console error. App continues to work via keyboard.

12.3 **Unfilled holes during eval.** Eval is rejected with a diagnostic; the affected output enters LKG fallback per [MAIN.md §2.1](MAIN.md). Holes do not crash the runtime.

12.4 **Gamepad disconnect mid-menu.** Menu auto-closes (cancel path); structural cursor returns to the menu-open position; document is unchanged.

12.5 **Menu open while another modal is open.** The radial layer's `when:` predicate is `menuStore.open`; other modals MUST NOT set `menuStore.open`. If a layer-stack ambiguity arises, the higher-precedence transient layer (the radial menu) wins; the other modal is rendered behind the dim layer but cannot receive gamepad input until the menu closes.

12.6 **Document edit during menu-open.** Not possible in v1 — the menu masks all input that would mutate the document. Keyboard `Esc` closes the menu but is the only keyboard input honoured.

---

## 13. Open / Deferred

13.1 **Per-context dynamic providers.** The manifest is static in v1. A `ContextProvider` interface (subsystems contributing items based on AST cursor position, runtime state, recent activity) is the natural extension. Tracked for v2.

13.2 **Doc-derived symbols.** Live extraction of user-defined names from the current document (via Lezer walk: `define`, `let`, `defn` bindings) is a high-value extension to the Symbols tab. Defer until the static manifest proves limiting.

13.3 **Plugin / snippet packs.** Third-party manifests merged into the active manifest at boot — like the wrapper-Meta extension story in [structural-editing.md §6.2](structural-editing.md). Deferred.

13.4 **The "both" modifier semantics.** Holding LB+RB simultaneously is wired as a third handedness value (`'both'`) but is a no-op in v1. Possible future meanings: multi-cursor lift (apply to all cursors); insert-and-eval (commit + immediate eval); inverse/flipped semantics for directional verbs; an entirely new fifth verb namespace. Not yet decided.

13.5 **Custom tabs and full reordering.** v1 ships pin-to-favorites only. A settings UI for building custom tabs is deferred.

13.6 **Pre-eval preview ("dry run").** The frozen-mode preview (§9.2) shows the proposed mutation but commits on the verb press. A hold-to-preview-release-to-cancel mode is plausible but adds latency; deferred.

13.7 **Always-visible HUD variant.** A persistent low-opacity menu always on screen is a different mental model. Deferred until the leader-fire-close model proves limiting.

13.8 ~~Digit-by-digit number drill.~~ **In v1 via §14** (Numpad sub-mode). The curated common-numbers list remains the fast path; the numpad sub-mode handles values not in the list.

13.9 ~~Soft alphabet (typing new symbols).~~ **In v1 via §14** (T9 sub-mode). The Symbols tab's curated names remain the fast path; T9 handles new symbol coinage and the `:string` hole type.

13.10 **Multi-cursor menu application.** v1 applies verbs against the single primary cursor. The structural-editing algebra supports cursor sets; lifting verbs to pointwise-apply (per [structural-editing.md §3.5](structural-editing.md)) is a natural extension. Likely the v2 meaning of `hand: 'both'`.

13.11 **Range cursor menu application.** v1 only handles a node cursor as the apply target. Range cursors (per [structural-editing.md §3.7](structural-editing.md)) need verb semantics defined per verb (Insert: insert before/after the range; Wrap: wrap the range as a single unit; etc.). Defer until use cases force it.

13.12 **Wrap/Call handedness disambiguation.** The semantics in §5.1.3 / §5.1.4 are committed but the user experience may surprise. Track real-world reactions in Phase D testing and refine.

13.13 **Auto-chain cancel policy.** Spec is committed (cancel leaves holes; user fills later). Alternatives include: auto-undo-entire-chain, fill-with-defaults. Re-evaluate if real-world friction emerges.

13.14 **Hole-typed numeric ranges.** A `($ freq :number)` hole has no min/max in v1. Future: holes carry inference rules akin to the live-edit range-inference table ([live-edit.md §3.4](live-edit.md)) so common-numbers picks are seeded within a likely range.

13.15 **Manifest hot-reload during development.** Editing `manifest.json` could refresh the live menu. Not v1; quality-of-life for content authoring.

13.16 **Localisation.** All labels are hardcoded English. Defer.

13.17 **Discoverability beyond Zen.** v1 leans on Zen mode (§10) as the practice surface. If real-world first-use friction is high, a one-shot tutorial overlay on first-ever menu invocation (per origin) is the next mitigation.

13.18 ~~`$` as a user symbol.~~ **Resolved.** The head symbol `$` is reserved at the parser level by structural ontology ([structural-editing.md §2.9.1](structural-editing.md)) — a list whose head is `$` and whose shape matches `($ <symbol> <:keyword>)` is parsed as a hole. User code containing `$` as a real symbol cannot exist in the structural representation; the gate moves from convention to mechanism.

13.19 **Modal/overlay stacking policy.** §12.5 says the radial menu is the highest-priority transient layer. If a runtime-driven modal (e.g. eval error, firmware-upgrade prompt) needs to interrupt the menu, the policy is currently "modal queues until menu closes." This may need refinement for genuinely-urgent modals (e.g. hardware disconnect that should pre-empt).

---

## 14. Text and numeric entry sub-modes

The menu hosts two terminal sub-modes for free-form value entry: **Numpad** (digits, decimal, comma, sign) and **T9** (alphabetic, phone-keypad style). Both reuse the menu's open lifecycle, dim layer, and breadcrumb. Reaching either is normally automatic via auto-chain when the cursor lands on a hole whose `:type` requires free-form input; the user can also enter manually by selecting a `Type number` / `Type text` synthetic item under the Literals / Symbols tabs.

### 14.1 Sub-mode placement in the state machine

```ts
type MenuState =
  | { phase: 'closed' }
  | { phase: 'open',     /* §2.4 fields */ }
  | { phase: 'numpad',   buffer: string, target: ApplyTarget, returnTo: 'closed' | 'open' }
  | { phase: 't9',       buffer: string, lastKey: ButtonName | null, lastKeyAt: number,
                         caseMode: 'lower' | 'upper', target: ApplyTarget, returnTo: 'closed' | 'open' }
```

15.1.1 The sub-modes are siblings of `open`, not states inside it: while `numpad` or `t9` is active, the rings render the digit / letter layout described below, not the manifest tabs/items. The `closed` ↔ `numpad` ↔ `closed` lifecycle treats numpad as a self-contained surface.

15.1.2 **Auto-chain entry.** When the cursor lands on a `hole` leaf whose type is `:number`, the chain runner enters `numpad` directly (skipping the picking phase) if the user setting `menu.holeAutoFreeForm` is `true` (default `true`). When `:string`, it enters `t9`. When `:symbol`, it enters the Symbols tab's `picking` phase; pressing `menu.text.open` from there switches into `t9` for new-name coinage.

15.1.3 **Manual entry.** The Literals tab carries a synthetic top-of-list item `Type number` that fires `menu.text.open(:number)`; the Symbols tab carries `Type new symbol` firing `menu.text.open(:symbol)`. These items dispatch the verb selected at freeze time (Insert / Replace / WrapWith / Call) once the buffer is committed — handedness flows through unchanged.

### 14.2 Numpad layout (left stick, polar)

The left stick selects a position on a phone-keypad grid. Magnitude bands:

| Band | Magnitude | Positions |
|---|---|---|
| Center | `mag < 0.4` | `5` |
| Inner ring | `0.4 ≤ mag < 0.7` | N=`2` NE=`3` E=`6` SE=`9` S=`8` SW=`7` W=`4` NW=`1` |
| Outer ring | `mag ≥ 0.7` | S=`0` SW=`,` SE=`.` (other compass points reserved: N=`±` NE=`e` E=`⌫` NW=`Esc` W=`✓`) |

15.2.1 The visual rendering is two concentric ring grids on the left side of the menu's centre, with the active position highlighted in real time as the stick moves. The centre column shows the live `buffer` value, formatted per its current type (decimal point if present, sign if any).

15.2.2 The right ring renders nothing in this sub-mode (it is reserved for future paginated number sets — e.g. recently-used numbers). The right stick is ignored.

### 14.3 Numpad face-button verbs

| Face | Action |
|---|---|
| **A** | Append the digit / character at the current stick position to `buffer`. |
| **X** | Commit `buffer` as a node and **start a new value** (clear `buffer`, stay in numpad). Use case: populating a vector — `[1 X 2 X 3 ✓]`. The committed node is appended in the same direction as the active verb's handedness; the apply target advances to the just-committed node so the next X commits as its sibling. |
| **Y** | Backspace (drop last char from `buffer`). No-op if buffer empty. |
| **B** | Exit. If `buffer` is non-empty, commit it as a node first (equivalent to single-tap of ✓), then return to `returnTo`. If `buffer` is empty, return to `returnTo` without committing. |
| **Start** | Confirm and fire the active verb on `buffer`. Equivalent to A→outer-W (✓). |
| **Back** | Cancel without committing; `buffer` is discarded. Returns to `returnTo`. |

15.3.1 **Outer-ring symbols**, when reached by the left stick and pressed via A:
- `±` toggles sign of `buffer` (no-op if buffer empty or already starts with `-` — second press removes the sign).
- `e` appends `e` for scientific notation (rejected if `buffer` is empty or already contains `e`).
- `⌫` is identical to face Y (provided as a stick-only path for users who want both hands on sticks).
- `✓` commits buffer + fires active verb (identical to Start).
- `Esc` cancels (identical to Back).

15.3.2 **Buffer parsing.** On commit, `buffer` is parsed as a number per the language's literal grammar. `0`, `0.5`, `-1.25`, `1e3` all parse. Invalid syntax (e.g. trailing `.`) produces a no-op flash and keeps the buffer for further editing.

15.3.3 **Apply target progression with face X.** When X is pressed, the buffer commits and the apply target updates to a position immediately after the just-committed node (sibling-after for `Insert` with `hand: 'right'`, sibling-before with `hand: 'left'`). Subsequent X / B presses continue to chain. This is the canonical "type a vector" workflow for numbers.

### 14.4 T9 layout (left stick, polar)

Same polar grid as numpad — same key positions. The face-button A is now multi-tap-cycling:

| Position | Tap 1 | Tap 2 | Tap 3 | Tap 4 |
|---|---|---|---|---|
| 2 | a | b | c | 2 |
| 3 | d | e | f | 3 |
| 4 | g | h | i | 4 |
| 5 | j | k | l | 5 |
| 6 | m | n | o | 6 |
| 7 | p | q | r | s |
| 8 | t | u | v | 8 |
| 9 | w | x | y | z |
| 0 | (space) | 0 |  |  |
| 1 | - | _ | / | 1 |
| `,` | , | ; | : |  |
| `.` | . | ! | ? |  |

15.4.1 **Multi-tap commit timing.** A character commits to `buffer` when (a) `T_t9Commit` (default 600 ms) elapses since the last A press at that position, or (b) the user moves the stick to a different position and presses A there, or (c) any non-A face button fires.

15.4.2 **Caps and digit toggles.**
- **RB** held (or tapped to latch): cycles the active alpha character through caps (A / B / C / 1 → A / B / C / 2 → and so on). Visual indicator on the centre buffer.
- **LB** held (or tapped to latch): forces digit-mode for the next press (3 = `3`, not `d`). Single-press semantics so the user can mix letters and digits without leaving t9.

15.4.3 **Face-button verbs.**

| Face | Action |
|---|---|
| **A** | Cycle character at current stick position (multi-tap). |
| **X** | Commit `buffer` as a node and start a new value (same role as numpad X). |
| **Y** | Backspace. |
| **B** | Exit (commit if non-empty, then return). |
| **Start** | Confirm and fire active verb. |
| **Back** | Cancel. |

15.4.4 **Buffer validation.** For `:symbol` holes, the buffer must satisfy the language's symbol-character rules (alphanumeric + `-` + `_` + `?` + `!`, must not start with a digit). Invalid characters are silently dropped at commit time; a console toast notes the rejection. For `:string` holes, all printable characters are accepted; the buffer is wrapped in `"..."` at commit time.

### 14.5 Visual and interaction model

15.5.1 **Centre breadcrumb.** Replaces the regular breadcrumb during sub-mode. Format: `Type ⟨freq⟩ :number   |   buffer: 4.4_  ` (where `_` is the cursor position). Right-aligned: a hint line `[A]append [X]commit+new [Y]⌫ [B]exit [Start]✓ [Back]cancel`.

15.5.2 **Live preview.** As in `frozen` (§9.2), the centre shows the predicted document state with `buffer` in the proposed position, re-rendered on every keystroke / stick move.

15.5.3 **Idle hint.** After 5 s with empty buffer in numpad: "stick selects digit · A appends · ✓ commits". After 5 s in t9: "stick selects key · A cycles letters · 600 ms idle commits".

### 14.6 Performance and reliability

15.6.1 **Buffer state** is local to the menu store; no document mutations occur until commit. A gamepad disconnect mid-entry behaves like Back (discard buffer, return to `returnTo`).

15.6.2 **No persistence.** Buffer state does not survive menu close. A user who exits before committing loses what they typed; this is intentional — the buffer is ephemeral by design.

15.6.3 **Cold-open performance.** Sub-mode entry from auto-chain must paint the digit / letter ring within 80 ms, matching §11.5's verb-commit budget.
