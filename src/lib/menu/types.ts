// src/lib/menu/types.ts
//
// Type system for the gamepad-driven radial menu (the centre-screen, double-ring
// command surface specified by docs/specs/radial-menu.md).
//
// PURE TYPES ONLY — no runtime logic. This file is the single declarative source
// for every shape the menu's reducer (state.ts), manifest loader (manifest.ts),
// verb implementations (verbs.ts), template parser (templates.ts), and Solid
// renderer (ui/menu/RadialMenu.tsx) consume. No imports from src/ui/, src/runtime/,
// src/effects/, or src/editors/ — the file must compile in isolation.
//
// The branded-string idiom (`string & { readonly __brand: "X" }`) follows the
// pattern established in src/lib/gamepad/types.ts (GestureKey, AxisChannelName,
// LayerName).

// ---------------------------------------------------------------------------
// 1. Identifiers — branded strings (spec §2.1)
// ---------------------------------------------------------------------------

/**
 * A menu tab's stable identifier. Declared in the manifest; unique within
 * `Manifest.tabs`.
 *
 * Branded so the compiler distinguishes tab IDs from category IDs and item IDs
 * even though all three are strings at runtime.
 *
 * @see docs/specs/radial-menu.md §2.1
 */
export type TabId = string & { readonly __brand: "TabId" };

/**
 * A category's stable identifier. Unique within its parent tab; not necessarily
 * unique across the whole manifest.
 *
 * @see docs/specs/radial-menu.md §2.1
 */
export type CategoryId = string & { readonly __brand: "CategoryId" };

/**
 * An item's stable identifier. Unique across the entire manifest (across all
 * tabs and categories) — the manifest lint enforces this (§7.2).
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §7.2
 */
export type ItemId = string & { readonly __brand: "ItemId" };

/**
 * Identifier for a "right tab" — a filter-view applied to a locked left
 * category's items. Unique within its parent tab's `rightTabs` list.
 *
 * Kept as a separate brand from `TabId` because right-tabs are scoped to a
 * single parent left-tab and their IDs do not need to be globally unique.
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §4.2
 */
export type RightTabId = string & { readonly __brand: "RightTabId" };

// ---------------------------------------------------------------------------
// 2. Verbs (spec §2.3)
// ---------------------------------------------------------------------------

/**
 * Bare discriminator for the menu's four apply verbs. Useful as a record key,
 * an action-name suffix, or a tag in telemetry where the handedness is carried
 * separately.
 *
 * The full verb (kind + handedness) is `Verb`.
 *
 * @see docs/specs/radial-menu.md §2.3
 * @see docs/specs/radial-menu.md §5
 */
export type VerbKind = "insert" | "replace" | "wrapWith" | "call";

/**
 * Which shoulder is held when a verb fires. Maps to the `hand` parameter of
 * each verb (§5.1).
 *
 * - `'left'`  — LB held at face-button press (sibling-before / picked-as-head)
 * - `'right'` — RB held at face-button press (sibling-after / target-as-head)
 * - `'both'`  — both shoulders held; reserved no-op flash in v1, kept in the
 *   type so the verb shape stays stable while v2 semantics are decided
 *   (§13.4).
 *
 * @see docs/specs/radial-menu.md §2.3
 * @see docs/specs/radial-menu.md §5.1
 * @see docs/specs/radial-menu.md §13.4
 */
export type Handedness = "left" | "right" | "both";

/**
 * A fully-qualified menu verb: a kind plus handedness. This is what the
 * dispatcher passes to `verbs.apply(...)`.
 *
 * Kept as a discriminated union (rather than a flat record) so future
 * verb-specific fields can attach to a single `kind` without bleeding into the
 * others.
 *
 * @see docs/specs/radial-menu.md §2.3
 */
export type Verb =
  | { readonly kind: "insert"; readonly hand: Handedness }
  | { readonly kind: "replace"; readonly hand: Handedness }
  | { readonly kind: "wrapWith"; readonly hand: Handedness }
  | { readonly kind: "call"; readonly hand: Handedness };

// ---------------------------------------------------------------------------
// 3. Holes (spec §2.2; structural-editing.md §2.9)
// ---------------------------------------------------------------------------

/**
 * The five typed-hole kinds shared with structural editing. Mirrors the
 * structural ontology's hole-type set verbatim — the menu does not have a
 * private hole concept.
 *
 * Auto-chain dispatch (§8.2):
 * - `'number'`  → Numpad sub-mode (§14) or Literals tab Numbers category
 * - `'symbol'`  → Symbols tab; T9 sub-mode (§14) for new names
 * - `'keyword'` → Literals tab, Keywords category
 * - `'expr'`    → top-level (any tab); chain pauses, user picks
 * - `'string'`  → T9 sub-mode (§14)
 *
 * v1 manifest lint rejects `'string'` for FunctionItem signatures (§7.2: "no
 * soft alphabet at function signature time") but the type itself remains
 * valid — snippet templates and runtime holes do use it.
 *
 * @see docs/specs/radial-menu.md §2.2
 * @see docs/specs/structural-editing.md §2.9
 */
export type HoleType = "number" | "symbol" | "keyword" | "expr" | "string";

/**
 * The declarative shape of a single hole inside a function signature or
 * snippet template. Surfaces in source as `($ name :type)` and folds to a
 * `hole` leaf at parse time (structural-editing.md §2.9.1).
 *
 * `default` is sensible-default content for an eventual `cancel-with-defaults`
 * action (deferred — see §13). Typed `unknown` because the actual shape
 * depends on `type` (a number for `:number` holes, a string for `:string`,
 * an AST fragment for `:expr`, etc.); concrete narrowing is the consumer's
 * responsibility.
 *
 * @see docs/specs/radial-menu.md §2.2
 * @see docs/specs/structural-editing.md §2.9
 */
export interface HoleSpec {
  readonly name: string;
  readonly type: HoleType;
  readonly default?: unknown;
}

// ---------------------------------------------------------------------------
// 4. Snippet templates — opaque forward declaration (spec §8.4)
// ---------------------------------------------------------------------------

/**
 * Opaque marker for a parsed snippet tree fragment with embedded holes.
 *
 * The concrete shape is produced by `parseTemplate(...)` in `templates.ts`
 * (separate task, useq-perform-4zt.69.15 / C6) and is intentionally not
 * specified here — this types file must compile in isolation, and the tree
 * fragment shape couples to structural-editing's AST which is beyond this
 * file's scope.
 *
 * Consumers (the verb implementations in verbs.ts) treat values of this type
 * as opaque pass-throughs.
 *
 * @see docs/specs/radial-menu.md §8.4
 */
export interface SnippetTemplate {
  readonly __brand: "SnippetTemplate";
}

// ---------------------------------------------------------------------------
// 5. Manifest items (spec §2.1)
// ---------------------------------------------------------------------------

/**
 * A callable form (built-in function, macro, special form). When applied via
 * Insert/Wrap/Call, the verb generates a compound whose head is `head` and
 * whose children are typed holes drawn from `signature`.
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §5.1
 */
export interface FunctionItem {
  readonly kind: "function";
  readonly id: ItemId;
  /** Display name shown on the right ring and the breadcrumb. */
  readonly label: string;
  /** The symbol inserted at the head position of the generated form. */
  readonly head: string;
  /**
   * Typed holes for auto-chain. Position in this array is the document order
   * the chain runner visits the holes in (§8.3).
   */
  readonly signature?: ReadonlyArray<HoleSpec>;
  readonly tags?: readonly string[];
}

/**
 * A bare symbol name (variable, identifier). Inserted as a leaf — no compound
 * is generated.
 *
 * @see docs/specs/radial-menu.md §2.1
 */
export interface SymbolItem {
  readonly kind: "symbol";
  readonly id: ItemId;
  readonly label: string;
  /** The bare symbol inserted into the document. */
  readonly text: string;
}

/**
 * A literal value (number, boolean, or keyword name). The `literalKind`
 * discriminator lets the verb implementation render the value correctly —
 * keywords are encoded as bare names in the manifest (no leading `:`); the
 * insertion code prefixes the colon (§7.4).
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §7.4
 */
export interface LiteralItem {
  readonly kind: "literal";
  readonly id: ItemId;
  readonly label: string;
  readonly literal: number | boolean | string;
  readonly literalKind: "number" | "boolean" | "keyword";
}

/**
 * A multi-token template (e.g. `(slow N body)`, `(if c t e)`). The template
 * is a parsed tree fragment with named, typed holes that drive the auto-chain
 * (§8.4).
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §8.4
 */
export interface SnippetItem {
  readonly kind: "snippet";
  readonly id: ItemId;
  readonly label: string;
  readonly template: SnippetTemplate;
}

/**
 * A picker-grade leaf in the manifest. Discriminated by `kind`. Each variant
 * is a distinct interface so verb implementations can pattern-match
 * exhaustively without runtime type tests.
 *
 * Note on the bead description's `verbs: Partial<Record<Verb, ItemBinding>>`
 * sketch: the spec (§2.1) is unambiguous and does not include a per-item
 * verb-binding map — verbs are derived from `kind` and the verb
 * implementation's logic, not from a manifest field. Following the spec.
 *
 * @see docs/specs/radial-menu.md §2.1
 */
export type MenuItem = FunctionItem | SymbolItem | LiteralItem | SnippetItem;

/**
 * A category bundles related items. Categories appear as segments on the
 * left ring of the active left-tab.
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §4.1
 */
export interface MenuCategory {
  readonly id: CategoryId;
  readonly label: string;
  /** SVG ref or unicode glyph rendered on the left-ring segment. */
  readonly icon?: string;
  readonly items: readonly MenuItem[];
}

/**
 * A right-tab declares a filter view applied to the items of whichever
 * left-category is currently hovered (§4.2). Right-tabs cycle on LB/RB while
 * the menu is in `cyclingRightTabs`.
 *
 * Spec calls for `filter: (items, state: AppState) => items` — passing a full
 * AppState is an over-coupling for a pure types module (AppState lives in
 * higher layers). Simpler shape: a pure function over items only. Consumers
 * that need richer context (e.g. the `Recent` filter in §4.2.1) close over
 * that context at construction time. This is a deliberate simplification of
 * the spec's signature — flagged here for revisit when right-tabs are
 * actually wired up.
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §4.2
 */
export interface RightTab {
  readonly id: RightTabId;
  readonly label: string;
  readonly filter: (items: readonly MenuItem[]) => readonly MenuItem[];
}

/**
 * A top-level tab. The four v1 left-tabs are `functions`, `symbols`,
 * `literals`, `snippets` (§4.1.1).
 *
 * @see docs/specs/radial-menu.md §2.1
 * @see docs/specs/radial-menu.md §4.1
 */
export interface MenuTab {
  readonly id: TabId;
  readonly label: string;
  readonly categories: readonly MenuCategory[];
  /** Optional right-ring sub-tabs cycled with LB/RB once a category is
   * hovered (§4.2). Absent => the right ring shows the unfiltered category. */
  readonly rightTabs?: readonly RightTab[];
}

/**
 * The top-level manifest document. v1 is loaded from
 * `src/lib/menu/manifest.json` (separate task, useq-perform-4zt.69.12 / C3).
 *
 * @see docs/specs/radial-menu.md §2.5
 * @see docs/specs/radial-menu.md §7.1
 */
export interface Manifest {
  readonly version: 1;
  readonly tabs: readonly MenuTab[];
}

// ---------------------------------------------------------------------------
// 6. Apply target — opaque forward declaration (spec §3.1.3)
// ---------------------------------------------------------------------------

/**
 * The structural cursor target captured at menu-open time and used as the
 * static reference for verb application throughout the menu's lifetime.
 *
 * Concrete shape is owned by structural-editing (a path or node ref into the
 * AST). Declared opaque here so this types file stays at the foundation
 * layer — the dispatcher binds it to the real cursor type at construction
 * time.
 *
 * @see docs/specs/radial-menu.md §3.1.3
 * @see docs/specs/structural-editing.md §3
 */
export interface ApplyTarget {
  readonly __brand: "ApplyTarget";
}

// ---------------------------------------------------------------------------
// 7. Live-tracking primitives (spec §2.4 / §4.3)
// ---------------------------------------------------------------------------

/**
 * Live ring-segment hover index, or `null` when the corresponding stick is
 * below the engagement threshold (default 0.5 — §4.5).
 *
 * The reducer treats `null` as "stick centred"; sub-phase derivation reads
 * `(leftHover, rightHover, frozen)` to decide which input bindings are live
 * (§3.3, transition table §6.1).
 *
 * @see docs/specs/radial-menu.md §2.4
 * @see docs/specs/radial-menu.md §4.3
 */
export type StickHover = number | null;

/**
 * Which shoulder(s) are currently held while the menu is open. Drives both
 * the freeze trigger (§3.3.2) and the verb's `hand` parameter (§5.1).
 *
 * @see docs/specs/radial-menu.md §2.4
 * @see docs/specs/radial-menu.md §3.3
 */
export type ShoulderHeld = "none" | "left" | "right" | "both";

/**
 * A latched snapshot of the user's pick at freeze entry — captures concrete
 * IDs (not hover indices) so subsequent stick movement cannot disturb the
 * picked item.
 *
 * @see docs/specs/radial-menu.md §2.4
 * @see docs/specs/radial-menu.md §3.3.2
 */
export interface FrozenSnapshot {
  readonly leftTabIdx: number;
  readonly leftPicked: CategoryId;
  readonly rightTabIdx: number;
  readonly rightPicked: ItemId;
}

// ---------------------------------------------------------------------------
// 8. MenuState (spec §2.4 + §14.1)
// ---------------------------------------------------------------------------

/**
 * The closed state — the menu is not mounted; gamepad input is dispatched to
 * the structural layer.
 *
 * @see docs/specs/radial-menu.md §2.4
 */
export interface MenuStateClosed {
  readonly phase: "closed";
}

/**
 * The open / picking state. The four sub-phases (`cyclingLeftTabs`,
 * `cyclingRightTabs`, `picking`, `frozen`) are *derived* from
 * `(leftHover, rightHover, frozen)` per §2.4 — no separate phase tag is
 * stored. The renderer and dispatcher compute the sub-phase on demand.
 *
 * @see docs/specs/radial-menu.md §2.4
 * @see docs/specs/radial-menu.md §3.3
 */
export interface MenuStateOpen {
  readonly phase: "open";
  readonly leftTabIdx: number;
  readonly rightTabIdx: number;
  readonly leftHover: StickHover;
  readonly rightHover: StickHover;
  readonly shoulderHeld: ShoulderHeld;
  readonly frozen: FrozenSnapshot | null;
  readonly target: ApplyTarget;
  readonly manifest: Manifest;
}

/**
 * The numpad sub-mode (§14.2). Sibling of `'open'`, not a child — while
 * numpad is active, the rings render the digit grid, not the manifest's
 * tabs/items.
 *
 * `returnTo` records where the user came from so Back / B can pop correctly
 * (auto-chain entered from `'closed'` returns to `'closed'`; manual entry
 * from picking returns to `'open'`).
 *
 * @see docs/specs/radial-menu.md §14.1
 * @see docs/specs/radial-menu.md §14.2
 */
export interface MenuStateNumpad {
  readonly phase: "numpad";
  readonly buffer: string;
  readonly target: ApplyTarget;
  readonly returnTo: "closed" | "open";
  /**
   * The verb to fire on commit (Start / outer-✓). Captured from the freeze
   * snapshot at sub-mode entry, or pre-set by auto-chain to the verb that
   * landed the cursor on the hole.
   */
  readonly activeVerb: Verb;
}

/**
 * The T9 sub-mode (§14.4). Tracks multi-tap state (`lastKey`, `lastKeyAt`)
 * and case mode in addition to the buffer.
 *
 * `lastKey` is the bare button name of the most recent multi-tap target. It
 * is typed as a string so this types file does not depend on the gamepad
 * layer's button-name union; the dispatcher narrows at construction time.
 *
 * @see docs/specs/radial-menu.md §14.1
 * @see docs/specs/radial-menu.md §14.4
 */
export interface MenuStateT9 {
  readonly phase: "t9";
  readonly buffer: string;
  readonly lastKey: string | null;
  /** `performance.now()`-style timestamp of the last A press at `lastKey`. */
  readonly lastKeyAt: number;
  readonly caseMode: "lower" | "upper";
  readonly target: ApplyTarget;
  readonly returnTo: "closed" | "open";
  readonly activeVerb: Verb;
}

/**
 * The full menu state — a discriminated union over `phase`. Reducer signature
 * is `(MenuState, MenuInput) => MenuState`; the reducer must be a pure
 * function (no DOM, no document, no gamepad refs).
 *
 * @see docs/specs/radial-menu.md §2.4
 * @see docs/specs/radial-menu.md §14.1
 */
export type MenuState =
  | MenuStateClosed
  | MenuStateOpen
  | MenuStateNumpad
  | MenuStateT9;

/**
 * Informative sub-phase derived from `MenuStateOpen`. Used by the renderer
 * and dispatcher to decide LB/RB roles (§3.3) and to gate the freeze
 * trigger (§3.3.3).
 *
 * Not stored in `MenuStateOpen` — derived on demand by `state.ts`.
 *
 * @see docs/specs/radial-menu.md §2.4
 */
export type OpenSubPhase =
  | "cyclingLeftTabs"
  | "cyclingRightTabs"
  | "picking"
  | "frozen";

// ---------------------------------------------------------------------------
// 9. MenuInput — reducer events (spec §6.1)
// ---------------------------------------------------------------------------

/**
 * Which shoulder a press / release event refers to. `'both'` is emitted when
 * LB and RB presses are coalesced inside `T_bothWindow` (§6.2.5).
 *
 * @see docs/specs/radial-menu.md §6.1
 * @see docs/specs/radial-menu.md §6.2.5
 */
export type ShoulderSide = "left" | "right" | "both";

/**
 * The four face buttons. Bound to verbs in `frozen` (§3.3): A=Insert,
 * X=Replace, Y=WrapWith, B=Call. Other roles in numpad / t9 (§14.3 / §14.4).
 *
 * Typed as a literal-union here (rather than importing the gamepad layer's
 * button-name brand) to keep this file at the foundation layer with no
 * cross-layer coupling.
 *
 * @see docs/specs/radial-menu.md §3.3
 */
export type MenuFace = "A" | "X" | "Y" | "B";

/**
 * The reducer's input alphabet. Every dispatcher event arrives here, gets
 * folded into a new `MenuState` by `state.reduce(...)`, and the dispatcher
 * acts on the resulting state (publishing document mutations, opening / closing
 * the overlay).
 *
 * @see docs/specs/radial-menu.md §6.1
 */
export type MenuInput =
  | {
      readonly kind: "open";
      readonly target: ApplyTarget;
      readonly manifest: Manifest;
    }
  /** Live left-stick poll. `hover` is null when stick is centred. */
  | { readonly kind: "axisLeft"; readonly hover: StickHover }
  /** Live right-stick poll. `hover` is null when stick is centred. */
  | { readonly kind: "axisRight"; readonly hover: StickHover }
  /** A discrete LB / RB tap. Sub-phase-gated tab-cycle. */
  | {
      readonly kind: "tabCycle";
      readonly side: "left" | "right";
      readonly dir: -1 | 1;
    }
  /** Edge: a shoulder transitions held → released (or vice versa). */
  | {
      readonly kind: "shoulderEdge";
      readonly side: ShoulderSide;
      readonly transition: "press" | "release";
      /** `performance.now()`-style timestamp; used for the both-window
       * coalescing rule (§6.2.5). */
      readonly ts: number;
    }
  /** A face button press while in `frozen`, numpad, or t9. */
  | { readonly kind: "face"; readonly face: MenuFace; readonly ts: number }
  /** Trigger axis tick — paginates the right ring (§4.4). */
  | { readonly kind: "trigger"; readonly side: "left" | "right" }
  /** Back / Select. Closes or pops one frozen step depending on sub-phase. */
  | { readonly kind: "back" }
  /** Explicit close (e.g. gamepad disconnect, keyboard Esc). */
  | { readonly kind: "cancel" }
  /** Open a free-form text entry sub-mode manually (§14.1.3). */
  | {
      readonly kind: "subModeOpen";
      readonly mode: "numpad" | "t9";
      readonly target: ApplyTarget;
      readonly activeVerb: Verb;
      readonly returnTo: "closed" | "open";
    }
  /** Numpad / T9 sub-mode: append a character to `buffer`. */
  | { readonly kind: "subModeAppend"; readonly char: string }
  /** Numpad / T9 sub-mode: backspace one character. */
  | { readonly kind: "subModeBackspace" }
  /** Numpad / T9 sub-mode: commit `buffer` and start a fresh value. */
  | { readonly kind: "subModeCommitAndContinue" }
  /** Numpad / T9 sub-mode: commit `buffer` and exit (Start / ✓). */
  | { readonly kind: "subModeCommitAndExit" }
  /** T9 multi-tap: cycle the character at the current stick position. */
  | { readonly kind: "subModeT9Cycle"; readonly key: string; readonly ts: number }
  /** T9 idle-commit timer fired (§14.4.1). */
  | { readonly kind: "subModeT9IdleCommit"; readonly ts: number };
