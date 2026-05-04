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
  Manifest,
  MenuFace,
  MenuInput,
  MenuState,
  MenuStateOpen,
  Verb,
  VerbKind,
} from "./types";
import { subPhase } from "./state";
import { applyVerb, type ApplyResult } from "./verbs";
import { nextChainStep, type ChainStep } from "./chain";
import type { CursorSet, IdGen, NodeId, Tree } from "../../editors/extensions/structure/core/types";
import { defaultIdGen } from "../../editors/extensions/structure/core/index";
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

  return {
    bind(editorView: EditorView): () => void {
      // Clear any previous bindings.
      unbind();

      boundView = editorView;
      ids = defaultIdGen("menu");

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
  };

  // -----------------------------------------------------------------------
  // Internal — unbind
  // -----------------------------------------------------------------------

  function unbind(): void {
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
    if (action === "menu.text.open") {
      // Text entry sub-mode is a future feature (H3+). For now, no-op.
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

    // Verb actions.
    if (MENU_VERB_ACTIONS.has(action)) {
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
}

// ---------------------------------------------------------------------------
// Helpers (pure, exported for testing)
// ---------------------------------------------------------------------------

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
