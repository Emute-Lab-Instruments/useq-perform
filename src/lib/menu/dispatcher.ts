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
//   2. `bind()` — subscribes to action routing, returns cleanup fn.
//   3. `open(target)` — transitions from closed to open.
//   4. On verb commit: reads frozen snapshot → applyVerb → editor mutation →
//      auto-chain check → reopen or close.
//   5. `close()` — cancels and closes.
//   6. Cleanup function returned by `bind()` unsubscribes.

import type { EditorView } from "@codemirror/view";

import type { ActionId } from "../keybindings/actions";
import type {
  ApplyTarget,
  Manifest,
  MenuInput,
  MenuState,
  Verb,
} from "./types";
import {
  loadManifest,
  getCachedManifest,
  setCachedManifest,
} from "./manifest";
import manifestJson from "./manifest.json" with { type: "json" };
import type { IdGen } from "../../editors/extensions/structure/core/types";
import { defaultIdGen } from "../../editors/extensions/structure/core/index";
import { currentApplyTarget, resolveHoleType } from "./editorTarget";
import { postVerbMenuInputs } from "./chainCoordination";
import { actionToVerbKind, applyMenuVerb } from "./verbApplication";
import {
  createTextEntryController,
  textModeForHoleType,
} from "./textEntry";

export {
  NUMPAD_INNER_COUNT,
  NUMPAD_TOTAL_COUNT,
  T9_DIGIT_LABELS,
  T9_POSITION_COUNT,
  numpadCharAt,
  t9CharAt,
  t9GroupAt,
  textModeForHoleType,
} from "./textEntry";

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
  /** Register action and axis subscriptions; returns their cleanup function. */
  bind(): () => void;

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
 * called.
 *
 * @see docs/specs/radial-menu.md §11.2
 */
export function createMenuDispatcher(deps: MenuDispatcherDeps): MenuDispatcher {
  // Cleanup functions accumulated during bind().
  let cleanups: Array<() => void> = [];

  // IdGen for verb applications. Fresh on each bind to avoid collisions.
  let ids: IdGen = defaultIdGen("menu");
  const textEntry = createTextEntryController(deps);

  return {
    bind(): () => void {
      // Clear any previous bindings.
      unbind();

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
      textEntry.appendNumpad(char);
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
    textEntry.reset();
    for (const cleanup of cleanups) {
      cleanup();
    }
    cleanups = [];
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
      if (textEntry.handleVerbAction(state, action)) return;

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
    if (textEntry.handleAxis(state, stick, hover)) return;

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

  function dispatchVerb(verbKind: import("./types").VerbKind): void {
    const result = applyMenuVerb({
      state: deps.getMenuState(),
      manifest: deps.getManifest(),
      view: deps.getEditorView(),
      verbKind,
      ids,
    });
    if (result.kind === "ignored") return;
    if (result.kind === "rejected") {
      deps.dispatchInput({ kind: "cancel" });
      return;
    }
    for (const input of postVerbMenuInputs(result.tree, result.cursorSet, deps.getManifest())) {
      deps.dispatchInput(input);
    }
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
