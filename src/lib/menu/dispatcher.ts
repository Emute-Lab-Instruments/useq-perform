// src/lib/menu/dispatcher.ts
//
// The single impure module that wires gamepad input to the menu state machine,
// applies verb mutations to the document, and handles auto-chain.
// Spec: docs/specs/radial-menu.md §11.2 (dispatcher spec), §11.4 (action registry).
//
// The dispatcher does NOT subscribe to raw gamepad input directly. It receives
// high-level action IDs (fireAction) and axis channel data (stickAxis
// subscription). The H2 paradigm layer (radial.ts) maps gamepad buttons to
// `menu.*` ActionIds; the dispatcher consumes those actions here.
//
// Lifecycle:
//   1. `createMenuDispatcher(deps)` — creates the dispatcher instance.
//   2. `bind(editorView)` — subscribes to action routing, returns cleanup fn.
//   3. `open(target)` — transitions from closed to open.
//   4. On verb commit: reads frozen snapshot → applyVerb → editor mutation →
//      auto-chain check → reopen or close.
//   5. `close()` — cancels and closes.
//   6. Cleanup function returned by `bind()` unsubscribes.

import type { EditorView } from "@codemirror/view";

import type { ActionId } from "../keybindings/actions";
import type {
  ApplyTarget,
  FrozenSnapshot,
  Handedness,
  HoleType,
  Manifest,
  MenuFace,
  MenuInput,
  MenuState,
  MenuStateNumpad,
  MenuStateOpen,
  MenuStateT9,
  Verb,
  VerbKind,
} from "./types";
import { subPhase } from "./state";
import { applyVerb, type ApplyResult } from "./verbs";
import { nextChainStep, type ChainStep } from "./chain";
import {
  loadManifest,
  getCachedManifest,
  setCachedManifest,
} from "./manifest";
import manifestJson from "./manifest.json";
import type { CursorSet, HoleNode, IdGen, NodeId, Tree } from "../../editors/extensions/structure/core/types";
import { defaultIdGen } from "../../editors/extensions/structure/core/index";
import { findById } from "../../editors/extensions/structure/core/traversal";
import { structField } from "../../editors/extensions/structure/adapter/stateField";
import { printNode } from "../../editors/extensions/structure/adapter/printTree";
import { executeEditorCommand } from "../../editors/commands/editorCommandRouter";
import type { ChangeSpec } from "@codemirror/state";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * The menu dispatcher — the single impure component in the menu system.
 * Receives high-level action IDs and axis data from the gamepad pipeline,
 * drives the pure state reducer, applies verb mutations to the editor, and
 * handles auto-chain re-opening.
 *
 * @see docs/specs/radial-menu.md §11.2
 */
export interface MenuDispatcher {
  /**
   * Bind the dispatcher to an editor view. Registers action handlers and
   * axis subscriptions. Returns an unsubscribe / cleanup function.
   */
  bind(editorView: EditorView): () => void;

  /**
   * Open the menu with a specific apply target. Reads the manifest from the
   * cached loader. No-op if the menu is already open.
   */
  open(target: ApplyTarget): void;

  /**
   * Close the menu (cancel path). Dispatches a `cancel` input to the reducer.
   */
  close(): void;

  /**
   * Handle a menu-related action ID. Called by the action routing layer
   * (either from `fireAction` in the gamepad pipeline or from the handler
   * registry).
   */
  handleAction(action: ActionId): void;

  /**
   * Handle an axis update (stick angle mapped to hover index).
   * `stick` is `"left"` or `"right"`, `hover` is the computed segment index
   * or `null` when below engagement threshold.
   */
  handleAxis(stick: "left" | "right", hover: number | null): void;

  /**
   * Append a character in numpad sub-mode. No-op if not in numpad phase.
   * Used by the gamepad paradigm layer for face-A presses mapped to the
   * current stick position's character (§14.3).
   */
  numpadAppend(char: string): void;

  /**
   * Handle a raw shoulder (LB / RB) press or release edge. This is the freeze
   * mechanic's input path (§3.3.2, §6.1): a press in the `picking` sub-phase
   * latches a FrozenSnapshot; releasing all shoulders clears it. Freeze is not
   * a user-visible action (§11.4) — it is intrinsic to the menu's input
   * handling — so it flows through here rather than through `handleAction`.
   *
   * `side` is `'left'` (LB), `'right'` (RB), or `'both'` (coalesced
   * near-simultaneous press/release per §6.2.5). `ts` is a
   * `performance.now()`-style timestamp.
   */
  handleShoulder(
    side: "left" | "right" | "both",
    transition: "press" | "release",
    ts: number,
  ): void;
}

// ---------------------------------------------------------------------------
// Dependencies (injected for testability)
// ---------------------------------------------------------------------------

/**
 * External dependencies the dispatcher needs. All are functions so the
 * dispatcher stays decoupled from global singletons.
 */
export interface MenuDispatcherDeps {
  /** Read the current menu state (from the Solid reactive store). */
  readonly getMenuState: () => MenuState;
  /** Dispatch a MenuInput to the state reducer (writes to the store). */
  readonly dispatchInput: (input: MenuInput) => void;
  /** Get the cached manifest, or null if loading failed (§12.2). */
  readonly getManifest: () => Manifest | null;
  /** Get the current EditorView, or undefined if no editor is focused. */
  readonly getEditorView: () => EditorView | undefined;
  /**
   * Register a callback for a set of action IDs. Returns an unregister fn.
   * The dispatcher uses this to receive `menu.*` actions from the gamepad
   * pipeline's action routing.
   */
  readonly onActions?: (
    actions: ReadonlySet<ActionId>,
    handler: (action: ActionId) => void,
  ) => () => void;
  /**
   * Register a callback for axis channel updates. Returns an unregister fn.
   */
  readonly onAxis?: (
    handler: (stick: "left" | "right", hover: number | null) => void,
  ) => () => void;
}

// ---------------------------------------------------------------------------
// Verb mapping: face button → verb kind
// ---------------------------------------------------------------------------

const FACE_TO_VERB_KIND: ReadonlyMap<MenuFace, VerbKind> = new Map([
  ["A", "insert"],
  ["X", "replace"],
  ["Y", "wrapWith"],
  ["B", "call"],
]);

// ---------------------------------------------------------------------------
// Action ID sets
// ---------------------------------------------------------------------------

const MENU_VERB_ACTIONS: ReadonlySet<ActionId> = new Set([
  "menu.verb.insert",
  "menu.verb.replace",
  "menu.verb.wrapWith",
  "menu.verb.call",
]);

const MENU_TAB_ACTIONS: ReadonlySet<ActionId> = new Set([
  "menu.tab.cyclePrev",
  "menu.tab.cycleNext",
]);

const MENU_ALL_ACTIONS: ReadonlySet<ActionId> = new Set([
  ...MENU_VERB_ACTIONS,
  ...MENU_TAB_ACTIONS,
  "menu.text.open",
  "menu.cancel",
  "menu.radial",
]);

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new menu dispatcher. The dispatcher is inert until `bind()` is
 * called with an EditorView.
 *
 * @see docs/specs/radial-menu.md §11.2
 */
export function createMenuDispatcher(deps: MenuDispatcherDeps): MenuDispatcher {
  // Cleanup functions accumulated during bind().
  let cleanups: Array<() => void> = [];

  // The current editor view — set during bind(), cleared on unbind.
  let boundView: EditorView | null = null;

  // IdGen for verb applications. Fresh on each bind to avoid collisions.
  let ids: IdGen = defaultIdGen("menu");

  // Numpad sub-mode: tracks the last character the left stick points at.
  // Updated by handleAxisImpl when the menu is in numpad phase. Used by
  // the face-A handler to look up the character to append (§14.2 / §14.3).
  let numpadHoverChar: string | null = null;

  // T9 sub-mode: tracks the current key index the left stick points at
  // and the multi-tap state for the current key (§14.4).
  let t9HoverIdx: number | null = null;
  let t9TapCount: number = 0;
  let t9ActiveIdx: number | null = null; // the position being multi-tapped
  let t9IdleTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    bind(editorView: EditorView): () => void {
      // Clear any previous bindings.
      unbind();

      boundView = editorView;
      ids = defaultIdGen("menu");

      // Pre-warm the manifest cache on first bind so the cold-open path
      // never hits a JSON parse. If the cache is already populated (e.g.
      // by a previous bind or a test), skip the redundant parse.
      if (getCachedManifest() === null) {
        const result = loadManifest(manifestJson);
        if (result.ok) {
          setCachedManifest(result.value);
        }
      }

      // Register action routing if the deps provide it.
      if (deps.onActions) {
        const unregister = deps.onActions(MENU_ALL_ACTIONS, (action) => {
          handleActionImpl(action);
        });
        cleanups.push(unregister);
      }

      // Register axis subscription if the deps provide it.
      if (deps.onAxis) {
        const unregister = deps.onAxis((stick, hover) => {
          handleAxisImpl(stick, hover);
        });
        cleanups.push(unregister);
      }

      return unbind;
    },

    open(target: ApplyTarget): void {
      const manifest = deps.getManifest();
      if (manifest === null) {
        // §12.2: menu disabled on manifest failure.
        return;
      }
      deps.dispatchInput({ kind: "open", target, manifest });
    },

    close(): void {
      deps.dispatchInput({ kind: "cancel" });
    },

    handleAction(action: ActionId): void {
      handleActionImpl(action);
    },

    handleAxis(stick: "left" | "right", hover: number | null): void {
      handleAxisImpl(stick, hover);
    },

    numpadAppend(char: string): void {
      const state = deps.getMenuState();
      if (state.phase === "numpad") {
        deps.dispatchInput({ kind: "subModeAppend", char });
      }
    },

    handleShoulder(side, transition, ts): void {
      // Only meaningful while the menu is open — the reducer drops shoulder
      // edges in every other phase (§3.3, reduceClosed). Guarding here keeps
      // the dispatcher from pushing redundant inputs when the menu is shut.
      const state = deps.getMenuState();
      if (state.phase !== "open") return;
      deps.dispatchInput({ kind: "shoulderEdge", side, transition, ts });
    },
  };

  // -----------------------------------------------------------------------
  // Internal — unbind
  // -----------------------------------------------------------------------

  function unbind(): void {
    clearT9Timer();
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups = [];
    boundView = null;
  }

  // -----------------------------------------------------------------------
  // Internal — action routing
  // -----------------------------------------------------------------------

  function handleActionImpl(action: ActionId): void {
    // menu.radial — open the menu with the current cursor target.
    if (action === "menu.radial") {
      const view = deps.getEditorView();
      if (!view) return;
      const target = currentApplyTarget(view);
      if (!target) return;
      const manifest = deps.getManifest();
      if (!manifest) return;
      deps.dispatchInput({ kind: "open", target, manifest });
      return;
    }

    // menu.cancel — close the menu.
    if (action === "menu.cancel") {
      deps.dispatchInput({ kind: "cancel" });
      return;
    }

    // menu.text.open — open text entry sub-mode (§14.1.3).
    // Routes to numpad for :number holes, T9 for :string / :symbol holes.
    // No-op (flash) for :keyword, :expr, or when no active hole.
    if (action === "menu.text.open") {
      const state = deps.getMenuState();
      // Can only open sub-mode from open or closed state.
      if (state.phase !== "open" && state.phase !== "closed") return;
      const view = deps.getEditorView();
      if (!view) return;
      const target = currentApplyTarget(view);
      if (!target) return;

      // Determine the hole type at the current cursor position.
      const holeType = resolveHoleType(view, target);

      // Route based on hole type (§14.1.2 / §14.1.3).
      const mode = textModeForHoleType(holeType);
      if (mode === null) {
        // :keyword, :expr, or no active hole — no-op flash.
        return;
      }

      // Resolve the active verb. When in open state with a frozen snapshot,
      // derive from the freeze; otherwise default to insert-left.
      const activeVerb = resolveActiveVerb(state);

      deps.dispatchInput({
        kind: "subModeOpen",
        mode,
        target,
        activeVerb,
        returnTo: state.phase === "open" ? "open" : "closed",
      });
      return;
    }

    // Tab cycling.
    if (action === "menu.tab.cyclePrev") {
      dispatchTabCycle("left", -1);
      return;
    }
    if (action === "menu.tab.cycleNext") {
      dispatchTabCycle("left", 1);
      return;
    }

    // Verb actions — in numpad phase, face buttons have different meanings (§14.3).
    if (MENU_VERB_ACTIONS.has(action)) {
      const state = deps.getMenuState();

      // Numpad face-button mapping per §14.3:
      //   A (insert)  → subModeAppend — the dispatcher must provide the char
      //                 via the stick→char mapping, but since we only receive
      //                 the action ID here, the append is handled by the
      //                 gamepad paradigm layer that sends subModeAppend
      //                 directly. Here we handle the other three faces.
      //   X (replace) → subModeCommitAndContinue
      //   Y (wrapWith)→ subModeBackspace
      //   B (call)    → subModeCommitAndExit
      if (state.phase === "numpad") {
        if (action === "menu.verb.replace") {
          deps.dispatchInput({ kind: "subModeCommitAndContinue" });
          return;
        }
        if (action === "menu.verb.wrapWith") {
          deps.dispatchInput({ kind: "subModeBackspace" });
          return;
        }
        if (action === "menu.verb.call") {
          deps.dispatchInput({ kind: "subModeCommitAndExit" });
          return;
        }
        // menu.verb.insert (face A) in numpad: append the character at the
        // current stick position. Per §14.3: "Append the digit / character at
        // the current stick position to buffer."
        if (action === "menu.verb.insert") {
          if (numpadHoverChar !== null) {
            deps.dispatchInput({ kind: "subModeAppend", char: numpadHoverChar });
          }
          return;
        }
      }

      // T9 face-button mapping per §14.4.3:
      //   A (insert)  → cycle character at current stick position (multi-tap)
      //   X (replace) → subModeCommitAndContinue
      //   Y (wrapWith)→ subModeBackspace
      //   B (call)    → subModeCommitAndExit
      if (state.phase === "t9") {
        if (action === "menu.verb.insert") {
          handleT9Cycle();
          return;
        }
        if (action === "menu.verb.replace") {
          // Commit any pending multi-tap character first
          commitPendingT9();
          deps.dispatchInput({ kind: "subModeCommitAndContinue" });
          return;
        }
        if (action === "menu.verb.wrapWith") {
          commitPendingT9();
          deps.dispatchInput({ kind: "subModeBackspace" });
          return;
        }
        if (action === "menu.verb.call") {
          commitPendingT9();
          deps.dispatchInput({ kind: "subModeCommitAndExit" });
          return;
        }
      }

      const verbKind = actionToVerbKind(action);
      if (verbKind) {
        dispatchVerb(verbKind);
      }
      return;
    }
  }

  // -----------------------------------------------------------------------
  // Internal — axis routing
  // -----------------------------------------------------------------------

  function handleAxisImpl(stick: "left" | "right", hover: number | null): void {
    const state = deps.getMenuState();

    // In numpad phase, the left stick selects a numpad key position.
    // We don't dispatch to the reducer (axis inputs are no-ops in numpad),
    // but we track the position so face-A can look up the character.
    if (state.phase === "numpad" && stick === "left") {
      numpadHoverChar = hover !== null ? numpadCharAt(hover) : null;
      return;
    }

    // In T9 phase, the left stick selects a T9 key position.
    // We track the position so face-A can look up the character group (§14.4).
    if (state.phase === "t9" && stick === "left") {
      t9HoverIdx = hover !== null && hover < T9_POSITION_COUNT ? hover : null;
      return;
    }

    if (state.phase !== "open") return;

    if (stick === "left") {
      deps.dispatchInput({ kind: "axisLeft", hover });
    } else {
      deps.dispatchInput({ kind: "axisRight", hover });
    }
  }

  // -----------------------------------------------------------------------
  // Internal — tab cycle
  // -----------------------------------------------------------------------

  function dispatchTabCycle(side: "left" | "right", dir: -1 | 1): void {
    const state = deps.getMenuState();
    if (state.phase !== "open") return;

    deps.dispatchInput({
      kind: "tabCycle",
      side,
      dir,
    });
  }

  // -----------------------------------------------------------------------
  // Internal — verb dispatch (the core of the dispatcher's impure work)
  // -----------------------------------------------------------------------

  function dispatchVerb(verbKind: VerbKind): void {
    const state = deps.getMenuState();
    if (state.phase !== "open") return;

    const openState = state as MenuStateOpen;

    // The state must be in the frozen sub-phase to fire a verb.
    const phase = subPhase(openState);
    if (phase !== "frozen") return;

    const frozen = openState.frozen;
    if (frozen === null) return;

    // Resolve the item from the manifest.
    const manifest = deps.getManifest();
    if (manifest === null) return;

    const item = resolveItem(manifest, frozen);
    if (item === null) return;

    // Derive the verb's hand from the frozen state's shoulderHeld.
    const hand: Handedness = openState.shoulderHeld === "none"
      ? "left" // fallback; shouldn't happen in frozen but be safe
      : openState.shoulderHeld;

    const verb: Verb = { kind: verbKind, hand };

    // Read the structural tree from the editor.
    const view = deps.getEditorView();
    if (!view) return;

    const structValue = view.state.field(structField, false);
    if (!structValue) return;

    const tree = structValue.state.tree;
    const cursorSet = structValue.state.cursors;

    // Apply the verb.
    const result: ApplyResult = applyVerb({
      tree,
      cursorSet,
      item,
      verb,
      ids,
    });

    if (!result.ok) {
      // Verb rejected the combination — flash and close.
      // §5.3 / §12.1: the verb produces a no-op flash.
      deps.dispatchInput({ kind: "cancel" });
      return;
    }

    // Apply the mutation to the editor.
    applyTreeMutation(view, structValue, tree, result.tree, result.cursorSet);

    // Transition the menu state to closed (the reducer handles this when
    // it sees a `face` input, but we bypass that — we dispatch `cancel`
    // to close after successful verb commit).
    // Actually per spec §6.1: face(F) when frozen → closed. But the
    // reducer handles that transition. However, we haven't dispatched a
    // `face` input — we handle the verb out-of-band. So we close
    // explicitly.
    deps.dispatchInput({ kind: "cancel" });

    // Auto-chain: check if the cursor landed on a hole.
    const chainStep = nextChainStep(result.tree, result.cursorSet, true);
    if (chainStep.reopen) {
      // Re-open the menu for the next hole.
      const currentManifest = deps.getManifest();
      if (currentManifest) {
        // Slight delay to let the editor re-parse before re-opening.
        // In practice the re-parse is synchronous (CodeMirror transaction),
        // so we can dispatch immediately.
        deps.dispatchInput({
          kind: "open",
          target: chainStep.target,
          manifest: currentManifest,
        });
      }
    }
  }

  // -----------------------------------------------------------------------
  // Internal — editor mutation
  // -----------------------------------------------------------------------

  /**
   * Apply a tree mutation to the editor. This mirrors `applyOp.ts`'s
   * strategy: find the affected top-level form, print it, and replace the
   * source range via `executeEditorCommand`.
   */
  function applyTreeMutation(
    view: EditorView,
    structValue: {
      readonly state: import("../../editors/extensions/structure/core/types").State;
      readonly idIndex: ReadonlyMap<
        NodeId,
        { readonly from: number; readonly to: number }
      >;
    },
    oldTree: Tree,
    newTree: Tree,
    newCursorSet: CursorSet,
  ): void {
    const oldChildren = oldTree.root.children;
    const newChildren = newTree.root.children;
    const docText = view.state.doc.toString();
    const idIndex = structValue.idIndex;

    // Determine if the number of top-level children changed.
    if (oldChildren.length !== newChildren.length) {
      // Whole-doc replace.
      const newDocText = newChildren.map((n) => printNode(n)).join("\n");
      executeEditorCommand(view, {
        kind: "replaceDocument",
        text: newDocText,
        source: "menu",
      });
      return;
    }

    // Find the differing top-level form.
    let differingIdx = -1;
    for (let i = 0; i < oldChildren.length; i++) {
      if (oldChildren[i] !== newChildren[i]) {
        if (differingIdx !== -1) {
          // Multiple forms differ — whole-doc replace.
          const newDocText = newChildren.map((n) => printNode(n)).join("\n");
          executeEditorCommand(view, {
            kind: "replaceDocument",
            text: newDocText,
            source: "menu",
          });
          return;
        }
        differingIdx = i;
      }
    }

    if (differingIdx === -1) {
      // No tree change — cursor-only update. This shouldn't happen for verb
      // commits but handle it gracefully.
      return;
    }

    // Single top-level form changed — targeted replace.
    const oldChild = oldChildren[differingIdx];
    const oldRange = idIndex.get(oldChild.id);

    if (!oldRange) {
      // Can't locate the old range — whole-doc fallback.
      const newDocText = newChildren.map((n) => printNode(n)).join("\n");
      executeEditorCommand(view, {
        kind: "replaceDocument",
        text: newDocText,
        source: "menu",
      });
      return;
    }

    const newChild = newChildren[differingIdx];
    const newText = printNode(newChild);

    const changes: ChangeSpec = {
      from: oldRange.from,
      to: oldRange.to,
      insert: newText,
    };

    executeEditorCommand(view, {
      kind: "applyChanges",
      changes,
      scrollIntoView: true,
      userEvent: "menu.verb",
      source: "menu",
    });
  }

  // -----------------------------------------------------------------------
  // Internal — T9 multi-tap cycling (spec §14.4)
  // -----------------------------------------------------------------------

  /**
   * Handle a face-A press in T9 mode. Multi-tap cycles through the
   * character group at the current stick position.
   *
   * §14.4.1: a character commits when:
   *   (a) T_t9Commit (600 ms) elapses since the last A press at that position
   *   (b) the user moves the stick to a different position and presses A
   *   (c) any non-A face button fires
   *
   * @see docs/specs/radial-menu.md §14.4
   */
  function handleT9Cycle(): void {
    const state = deps.getMenuState();
    if (state.phase !== "t9") return;
    const t9State = state as MenuStateT9;

    const pos = t9HoverIdx;
    if (pos === null) return; // no stick position → no-op

    const group = t9GroupAt(pos);
    if (group === null) return;

    const ts = performance.now();

    // Determine if we're continuing a multi-tap on the same position or
    // starting a new one.
    if (t9ActiveIdx !== null && t9ActiveIdx === pos) {
      // Same position — cycle to the next character in the group.
      t9TapCount++;
    } else {
      // Different position — commit any pending character from the previous.
      if (t9ActiveIdx !== null) {
        commitPendingT9();
      }
      t9ActiveIdx = pos;
      t9TapCount = 0;
    }

    // Compute the character at this tap position.
    const char = t9CharAt(pos, t9TapCount, t9State.caseMode === "upper");
    if (char === null) return;

    // If this is the first tap on a new position, append the character.
    // If this is a subsequent tap on the same position, replace the trailing
    // character in the buffer.
    if (t9TapCount === 0) {
      // First tap on this position — append.
      deps.dispatchInput({ kind: "subModeAppend", char });
    } else {
      // Subsequent tap — replace trailing char: backspace + append.
      deps.dispatchInput({ kind: "subModeBackspace" });
      deps.dispatchInput({ kind: "subModeAppend", char });
    }

    // Update the multi-tap bookkeeping in the state machine.
    const digitLabel = T9_DIGIT_LABELS[pos] ?? String(pos);
    deps.dispatchInput({ kind: "subModeT9Cycle", key: digitLabel, ts });

    // Reset the idle timer.
    resetT9Timer();
  }

  /**
   * Commit any pending multi-tap character. After commit, the character
   * is frozen in the buffer and a new tap starts fresh.
   */
  function commitPendingT9(): void {
    if (t9ActiveIdx === null) return;
    const ts = performance.now();
    deps.dispatchInput({ kind: "subModeT9IdleCommit", ts });
    t9ActiveIdx = null;
    t9TapCount = 0;
    clearT9Timer();
  }

  /**
   * Reset the T9 idle-commit timer. Called on each face-A press.
   */
  function resetT9Timer(): void {
    clearT9Timer();
    t9IdleTimer = setTimeout(() => {
      const state = deps.getMenuState();
      if (state.phase !== "t9") {
        t9ActiveIdx = null;
        t9TapCount = 0;
        return;
      }
      commitPendingT9();
    }, T9_COMMIT_TIMEOUT_MS);
  }

  /**
   * Clear the T9 idle-commit timer.
   */
  function clearT9Timer(): void {
    if (t9IdleTimer !== null) {
      clearTimeout(t9IdleTimer);
      t9IdleTimer = null;
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

/**
 * Numpad character lookup table per spec §14.2 polar grid.
 *
 * The inner ring has 8 compass positions + centre (index 8 = "5").
 * The outer ring has 8 compass positions. Indices 0–7 = inner ring,
 * indices 8–15 = outer ring.
 *
 * Inner ring (8 segments, compass order): NW=1, N=2, NE=3, W=4,
 * E=6, SW=7, S=8, SE=9. Centre=5.
 *
 * Outer ring (8 segments, compass order): S=0, SW=',', SE='.',
 * N='±', NE='e', E='⌫', NW='Esc', W='✓'.
 *
 * @see docs/specs/radial-menu.md §14.2
 */
const NUMPAD_CHARS: readonly string[] = [
  // Inner ring (indices 0–7): compass order NW, N, NE, W, E, SW, S, SE
  "1", "2", "3", "4", "6", "7", "8", "9",
  // Centre (index 8)
  "5",
  // Outer ring (indices 9–16): compass order S, SW, SE, N, NE, E, NW, W
  "0", ",", ".", "±", "e", "⌫", "Esc", "✓",
];

/**
 * Map a numpad segment index to its character. Returns null for out-of-range.
 *
 * @see docs/specs/radial-menu.md §14.2
 */
export function numpadCharAt(index: number): string | null {
  if (index < 0 || index >= NUMPAD_CHARS.length) return null;
  return NUMPAD_CHARS[index] ?? null;
}

/** Number of inner-ring + centre positions (indices 0–8). */
export const NUMPAD_INNER_COUNT = 9;

/** Total numpad positions (inner + centre + outer). */
export const NUMPAD_TOTAL_COUNT = NUMPAD_CHARS.length;

// ---------------------------------------------------------------------------
// T9 character groups (spec §14.4)
// ---------------------------------------------------------------------------

/**
 * T9 multi-tap character groups per spec §14.4 polar grid.
 *
 * Key positions match the numpad layout (same polar grid). Each entry maps
 * a key index to the characters available at that position. Multi-tap cycles
 * through the characters: tap 1 = char 0, tap 2 = char 1, etc.
 *
 * The T9 layout reuses the numpad's inner ring positions (indices 0–8):
 *   0=NW(1), 1=N(2), 2=NE(3), 3=W(4), 4=E(6),
 *   5=SW(7), 6=S(8), 7=SE(9), 8=centre(5)
 *
 * @see docs/specs/radial-menu.md §14.4
 */
const T9_GROUPS: readonly (readonly string[])[] = [
  // Index 0 (NW position, digit 1): symbols
  ["-", "_", "/", "1"],
  // Index 1 (N position, digit 2): abc
  ["a", "b", "c", "2"],
  // Index 2 (NE position, digit 3): def
  ["d", "e", "f", "3"],
  // Index 3 (W position, digit 4): ghi
  ["g", "h", "i", "4"],
  // Index 4 (centre position, digit 5): jkl
  ["j", "k", "l", "5"],
  // Index 5 (E position, digit 6): mno
  ["m", "n", "o", "6"],
  // Index 6 (SW position, digit 7): pqrs
  ["p", "q", "r", "s"],
  // Index 7 (S position, digit 8): tuv
  ["t", "u", "v", "8"],
  // Index 8 (SE position, digit 9): wxyz
  ["w", "x", "y", "z"],
];

/** T9 commit idle timeout in ms (spec §14.4.1). */
const T9_COMMIT_TIMEOUT_MS = 600;

/**
 * The digit label for each T9 position (for display and identification).
 */
export const T9_DIGIT_LABELS: readonly string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Number of T9 positions. */
export const T9_POSITION_COUNT = T9_GROUPS.length;

/**
 * Map a T9 key index to its character group. Returns null for out-of-range.
 *
 * @see docs/specs/radial-menu.md §14.4
 */
export function t9GroupAt(keyIndex: number): readonly string[] | null {
  if (keyIndex < 0 || keyIndex >= T9_GROUPS.length) return null;
  return T9_GROUPS[keyIndex] ?? null;
}

/**
 * Compute the character at a given T9 key position and tap count.
 * Cycles through the group: `tapCount % group.length`.
 *
 * @param keyIndex — T9 key position (0–8)
 * @param tapCount — number of taps at this position (0-based)
 * @param upper — whether to return uppercase (RB latch)
 * @returns the character, or null if the key index is invalid
 *
 * @see docs/specs/radial-menu.md §14.4
 */
export function t9CharAt(keyIndex: number, tapCount: number, upper: boolean = false): string | null {
  const group = t9GroupAt(keyIndex);
  if (group === null) return null;
  const char = group[tapCount % group.length];
  if (char === undefined) return null;
  return upper ? char.toUpperCase() : char;
}

/**
 * Map a menu verb action ID to its VerbKind.
 */
function actionToVerbKind(action: ActionId): VerbKind | null {
  switch (action) {
    case "menu.verb.insert":
      return "insert";
    case "menu.verb.replace":
      return "replace";
    case "menu.verb.wrapWith":
      return "wrapWith";
    case "menu.verb.call":
      return "call";
    default:
      return null;
  }
}

/**
 * Resolve the frozen snapshot's picked item from the manifest.
 * Returns null if the category or item is missing.
 */
function resolveItem(
  manifest: Manifest,
  frozen: FrozenSnapshot,
): import("./types").MenuItem | null {
  const tab = manifest.tabs[frozen.leftTabIdx];
  if (!tab) return null;
  const category = tab.categories.find((c) => c.id === frozen.leftPicked);
  if (!category) return null;
  const item = category.items.find((i) => i.id === frozen.rightPicked);
  return item ?? null;
}

/**
 * Create an ApplyTarget from the current structural cursor in the editor.
 * Returns null if the editor or struct field is not available.
 */
function currentApplyTarget(view: EditorView): ApplyTarget | null {
  const structValue = view.state.field(structField, false);
  if (!structValue) return null;
  const primary = structValue.state.cursors.primary;
  const targetId =
    primary.kind === "node" ? primary.target : primary.start;
  // Brand the node id as an ApplyTarget.
  return { __brand: "ApplyTarget", nodeId: targetId } as unknown as ApplyTarget;
}

/**
 * Resolve the hole type at the current apply target position.
 * Looks up the structural node at the target and returns its holeType
 * if it is a HoleNode; returns null otherwise.
 *
 * @see docs/specs/radial-menu.md §14.1.2
 */
function resolveHoleType(view: EditorView, target: ApplyTarget): HoleType | null {
  const structValue = view.state.field(structField, false);
  if (!structValue) return null;
  const nodeId = (target as unknown as { nodeId: NodeId }).nodeId;
  if (nodeId === undefined) return null;
  const node = findById(structValue.state.tree.root, nodeId);
  if (node === null || node.kind !== "hole") return null;
  return (node as HoleNode).holeType ?? null;
}

/**
 * Map a hole type to the appropriate text-entry sub-mode.
 * Per spec §14.1.2 / §14.1.3:
 * - `:number` → numpad (free-form numeric entry)
 * - `:string` → T9 (character-by-character text entry)
 * - `:symbol` → T9 (new-name coinage)
 * - `:keyword`, `:expr`, or null → no-op (returns null)
 *
 * @see docs/specs/radial-menu.md §14.1.2
 */
export function textModeForHoleType(holeType: HoleType | null): "numpad" | "t9" | null {
  if (holeType === null) return null;
  switch (holeType) {
    case "number":
      return "numpad";
    case "string":
    case "symbol":
      return "t9";
    case "keyword":
    case "expr":
      return null;
    default:
      return null;
  }
}

/**
 * Resolve the active verb for a sub-mode entry. When the menu is in the
 * open state with a frozen snapshot, derive the verb from the shoulder held
 * (hand). Otherwise default to insert-left.
 */
function resolveActiveVerb(state: MenuState): Verb {
  if (state.phase === "open" && state.frozen !== null) {
    const hand = state.shoulderHeld === "none" ? "left" : state.shoulderHeld;
    return { kind: "insert", hand };
  }
  return { kind: "insert", hand: "left" };
}
