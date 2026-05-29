// src/lib/keybindings/handlers.ts
//
// Handler registry — maps ActionIds to their implementation functions.
// This is the bridge between the pure-data action registry and the
// runtime modules that actually perform each action.
//
// Editor-invokable actions are registered here regardless of whether they are
// triggered by keyboard, gamepad, palette, or another input resolver. Menu UI
// actions and analog-only streams still use their own typed channels.

import type { EditorView } from "@codemirror/view";
import type { ActionId } from "./actions.ts";

// ---------------------------------------------------------------------------
// Handler types
// ---------------------------------------------------------------------------

/** Handler that receives the CodeMirror EditorView. */
export type EditorHandler = (view: EditorView) => boolean;

/** Handler that needs no editor context (panel toggles, etc.). */
export type VoidHandler = () => boolean;

/** Union of both handler shapes. */
export type ActionHandler = EditorHandler | VoidHandler;

// ---------------------------------------------------------------------------
// Imports from runtime modules
// ---------------------------------------------------------------------------

import { evaluate } from "../../effects/editorEvaluation.ts";
import {
  toggleHelp,
  toggleSerialVis,
  showDocumentationForSymbol,
} from "../../editors/editorKeyboard.ts";
import { requestVisScreenshot } from "../../ui/visualisation/serialVisGL.ts";
import {
  toggleCurrentProbe,
  expandCurrentProbeContext,
  contractCurrentProbeContext,
} from "../../editors/extensions/probes.ts";
import { executeLiveEditMark } from "../../editors/extensions/liveEdit/markAction.ts";
import { handleToggleVisAtHalo } from "../../editors/extensions/expressionEval.ts";
import {
  cursorCharLeft,
  cursorCharRight,
  cursorLineDown,
  cursorLineEnd,
  cursorLineStart,
  cursorLineUp,
} from "@codemirror/commands";
import { SAMPLE_CODE } from "./sampleCode.ts";
import { openPalette } from "../../ui/keybindings/ActionPalette.tsx";
import { executeEditorCommand } from "../../editors/commands/editorCommandRouter.ts";
import {
  startGrab,
  endGrab,
  isGrabActive,
  recordGrabMove,
  getGrabMoveCount,
  getGrabSnapshot,
} from "../gamepad/grabState.ts";
import {
  setGrabMode,
  setStructState,
  structField,
} from "../../editors/extensions/structure/adapter/stateField.ts";
import { pathsFromCursorSet } from "../../editors/extensions/structure/adapter/cursorPath.ts";
import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import {
  openMainMenu,
  closeMainMenu,
  isMainMenuOpen,
  dispatchMainMenu,
  mainMenuState,
} from "../mainMenu/store.ts";
import { resolveItems } from "../../ui/mainMenu/menuItems.ts";

// ---------------------------------------------------------------------------
// Clojure-mode handler extraction (legacy — retained only for killToEndOfList
// which has no functional-core equivalent yet)
// ---------------------------------------------------------------------------

function findClojureHandler(key: string): EditorHandler | undefined {
  const binding = completeClojureKeymap.find(
    (b: { key?: string }) => b.key === key,
  );
  return binding?.run as EditorHandler | undefined;
}

const killToEndOfList = findClojureHandler("Ctrl-k");

// ---------------------------------------------------------------------------
// Structural-editing handlers via the functional core adapter.
//
// Each edit.* action that the core supports is dispatched through the adapter's
// `dispatchAction`, which: reads the core State from the editor, runs the pure
// op, and applies the resulting tree change back as a CodeMirror transaction.
// ---------------------------------------------------------------------------

function restoreCursorsFromPaths(
  paths: ReadonlyArray<ReadonlyArray<number>>,
  tree: import("../../editors/extensions/structure/core/types.ts").Tree,
): import("../../editors/extensions/structure/core/types.ts").CursorSet {
  type CoreNode = import("../../editors/extensions/structure/core/types.ts").Node;
  const out = paths.map((p) => {
    let cur: CoreNode = tree.root;
    for (const i of p) {
      if (
        cur.kind === "list" || cur.kind === "vector" ||
        cur.kind === "map" || cur.kind === "set" || cur.kind === "document"
      ) {
        const next: CoreNode | undefined = cur.children[i];
        if (!next) { cur = tree.root; break; }
        cur = next;
      } else {
        cur = tree.root;
        break;
      }
    }
    return { kind: "node" as const, target: cur.id };
  });
  if (out.length === 0) {
    return { primary: { kind: "node" as const, target: tree.root.id }, secondaries: [] };
  }
  return { primary: out[0], secondaries: out.slice(1) };
}

function structHandler(dispatchName: string): EditorHandler {
  return (view) =>
    executeEditorCommand(view, {
      kind: "structural",
      action: dispatchName,
      source: "keyboard",
    });
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

const handlers: Partial<Record<ActionId, ActionHandler>> = {
  // -- Core (evaluation) ----------------------------------------------------
  "eval.now": (view: EditorView) => evaluate(view, "expression"),
  "eval.quantised": (view: EditorView) => evaluate(view, "toplevel"),
  "eval.soft": (view: EditorView) => evaluate(view, "soft"),

  // -- UI -------------------------------------------------------------------
  "palette.open": () => { openPalette(); return true; },
  "panel.help": toggleHelp,
  "panel.vis": toggleSerialVis,
  "vis.screenshot": () => { requestVisScreenshot(); return true; },

  // -- Vis (expression-gutter.md §4.1) ---------------------------------------
  "vis.toggleAtHalo": (view: EditorView) => handleToggleVisAtHalo(view),

  // -- Main menu (main-menu.md) ----------------------------------------------
  "mainMenu.open": () => {
    if (isMainMenuOpen()) {
      closeMainMenu();
    } else {
      openMainMenu();
    }
    return true;
  },
  "mainMenu.close": () => { closeMainMenu(); return true; },
  "mainMenu.next": () => {
    const items = resolveItems(mainMenuState().submenuStack);
    dispatchMainMenu({ type: "next", itemCount: items.length });
    return true;
  },
  "mainMenu.prev": () => {
    const items = resolveItems(mainMenuState().submenuStack);
    dispatchMainMenu({ type: "prev", itemCount: items.length });
    return true;
  },
  "mainMenu.select": () => {
    const state = mainMenuState();
    const items = resolveItems(state.submenuStack);
    const item = items[state.focusIndex];
    if (!item) return true;
    if (item.type === "submenu") {
      dispatchMainMenu({ type: "pushSubmenu", submenuId: item.id });
    } else {
      // Action items close the menu (resume or any other action)
      closeMainMenu();
    }
    return true;
  },
  "mainMenu.back": () => { dispatchMainMenu({ type: "back" }); return true; },
  "mainMenu.adjustUp": () => { /* stub — no adjustable items yet */ return true; },
  "mainMenu.adjustDown": () => { /* stub — no adjustable items yet */ return true; },

  // -- Editor ---------------------------------------------------------------
  "edit.pasteSample": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "replaceDocument",
      text: SAMPLE_CODE,
      source: "keyboard",
    }),
  "doc.symbol": showDocumentationForSymbol,
  "edit.undo": (view: EditorView) =>
    executeEditorCommand(view, { kind: "undo", source: "keyboard" }),
  "edit.redo": (view: EditorView) =>
    executeEditorCommand(view, { kind: "redo", source: "keyboard" }),
  "edit.delete": (view: EditorView) =>
    executeEditorCommand(view, { kind: "deleteNode", source: "keyboard" }),

  // -- Navigation (cursor movement) ------------------------------------------
  "nav.home": cursorLineStart,
  "nav.end": cursorLineEnd,

  // -- Spatial navigation (primary D-pad / arrow direction; structural-editing.md §5.1-A)
  "nav.up": structHandler("nav.up"),
  "nav.down": structHandler("nav.down"),
  "nav.left": structHandler("nav.left"),
  "nav.right": structHandler("nav.right"),

  // -- Tree-level navigation (secondary; structural-editing.md §5.1-B)
  "nav.in": structHandler("nav.in"),
  "nav.out": structHandler("nav.out"),
  "nav.next": structHandler("nav.next"),
  "nav.prev": structHandler("nav.prev"),
  "nav.first": structHandler("nav.first"),
  "nav.last": structHandler("nav.last"),
  "nav.extendNext": structHandler("nav.extendNext"),
  "nav.extendPrev": structHandler("nav.extendPrev"),
  "nav.shrink": structHandler("nav.shrink"),
  "nav.nextHole": structHandler("nav.nextHole"),
  "nav.prevHole": structHandler("nav.prevHole"),

  // -- Structure (functional-core via adapter dispatcher) --------------------
  "edit.slurpFwd": structHandler("edit.slurpForward"),
  "edit.slurpBack": structHandler("edit.slurpBackward"),
  "edit.barfFwd": structHandler("edit.barfForward"),
  "edit.barfBack": structHandler("edit.barfBackward"),
  "edit.raise": structHandler("edit.raise"),
  "edit.splice": structHandler("edit.splice"),
  "edit.wrapList": structHandler("edit.encloseList"),
  "edit.wrapVector": structHandler("edit.encloseVector"),
  "edit.wrapMap": structHandler("edit.encloseMap"),
  "edit.wrapSet": structHandler("edit.encloseSet"),
  "edit.transposeFwd": structHandler("edit.transposeNext"),
  "edit.transposeBack": structHandler("edit.transposePrev"),

  // -- Meta operations (§6.6) -----------------------------------------------
  "meta.add": structHandler("meta.add"),
  "meta.remove": structHandler("meta.remove"),
  "meta.cycle": structHandler("meta.cycle"),
  "meta.foldToggle": structHandler("meta.foldToggle"),

  // -- Atom manipulation (atom-manipulation.md §2-§5) -----------------------
  "atom.adjustUp": (view: EditorView) =>
    executeEditorCommand(view, { kind: "atomAdjust", direction: 1, source: "gamepad" }),
  "atom.adjustDown": (view: EditorView) =>
    executeEditorCommand(view, { kind: "atomAdjust", direction: -1, source: "gamepad" }),
  "atom.flipPolarity": (view: EditorView) =>
    executeEditorCommand(view, { kind: "atomFlipPolarity", source: "gamepad" }),

  // -- Gamepad editor actions ------------------------------------------------
  "control.toggleManualLeft": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "left",
      source: "gamepad",
    }),
  "control.toggleManualRight": (view: EditorView) =>
    executeEditorCommand(view, {
      kind: "toggleManualControl",
      stick: "right",
      source: "gamepad",
    }),

  // -- Structure (legacy — no core equivalent yet) --------------------------
  ...(killToEndOfList && { "edit.killToEndOfList": killToEndOfList }),

  // -- Probe ----------------------------------------------------------------
  "probe.toggle": (view: EditorView) => toggleCurrentProbe(view, "contextual"),
  "probe.toggleRaw": (view: EditorView) => toggleCurrentProbe(view, "raw"),
  "probe.expand": expandCurrentProbeContext,
  "probe.contract": contractCurrentProbeContext,

  // -- Document-root bulk (§5.3) --------------------------------------------
  "doc.deleteAll": structHandler("doc.deleteAll"),
  "doc.cutAll": structHandler("doc.cutAll"),
  "doc.copyAll": structHandler("doc.copyAll"),
  "doc.selectAll": structHandler("doc.selectAll"),

  // -- Live-Edit ------------------------------------------------------------
  "liveEdit.mark": executeLiveEditMark,
  "liveEdit.vectorConfirm": structHandler("liveEdit.vectorConfirm"),
  "liveEdit.vectorCancel": structHandler("liveEdit.vectorCancel"),

  // -- Grab mode (gamepad.md §6.6.4) -----------------------------------------
  "actOn.grab": (view: EditorView) => {
    if (isGrabActive()) return true;
    const value = view.state.field(structField, false);
    const doc = view.state.doc.toString();
    const paths = value
      ? pathsFromCursorSet(value.state.cursors, value.state.tree)
      : [];
    startGrab(doc, paths);
    view.dispatch({ effects: setGrabMode.of(true) });
    return true;
  },
  "actOn.drop": (view: EditorView) => {
    if (!isGrabActive()) return false;
    endGrab();
    view.dispatch({ effects: setGrabMode.of(false) });
    return true;
  },
  "actOn.cancelGrab": (view: EditorView) => {
    if (!isGrabActive()) return false;
    const snapshot = getGrabSnapshot();
    const count = getGrabMoveCount();
    endGrab();
    for (let i = 0; i < count; i++) {
      executeEditorCommand(view, { kind: "undo", source: "gamepad" });
    }
    if (snapshot) {
      const value = view.state.field(structField, false);
      if (value) {
        const cursors = restoreCursorsFromPaths(snapshot.cursorPaths, value.state.tree);
        view.dispatch({
          effects: [
            setStructState.of({
              state: { tree: value.state.tree, cursors },
              idIndex: value.idIndex,
              cursorPaths: snapshot.cursorPaths,
            }),
            setGrabMode.of(false),
          ],
        });
        return true;
      }
    }
    view.dispatch({ effects: setGrabMode.of(false) });
    return true;
  },
  "actOn.duplicateDrop": (view: EditorView) => {
    if (!isGrabActive()) return false;
    endGrab();
    view.dispatch({ effects: setGrabMode.of(false) });
    return true;
  },
  "grab.moveLeft": (view: EditorView) => {
    if (!isGrabActive()) return false;
    const ok = executeEditorCommand(view, {
      kind: "structural", action: "edit.transposePrev", source: "gamepad",
    });
    if (ok) recordGrabMove();
    return ok;
  },
  "grab.moveRight": (view: EditorView) => {
    if (!isGrabActive()) return false;
    const ok = executeEditorCommand(view, {
      kind: "structural", action: "edit.transposeNext", source: "gamepad",
    });
    if (ok) recordGrabMove();
    return ok;
  },
  "grab.moveUp": (view: EditorView) => {
    if (!isGrabActive()) return false;
    const ok = executeEditorCommand(view, {
      kind: "structural", action: "edit.raise", source: "gamepad",
    });
    if (ok) recordGrabMove();
    return ok;
  },
  "grab.moveDown": (view: EditorView) => {
    if (!isGrabActive()) return false;
    const ok = executeEditorCommand(view, {
      kind: "structural", action: "edit.encloseList", source: "gamepad",
    });
    if (ok) recordGrabMove();
    return ok;
  },

  // -- Insertion mode (character-level caret movement) ----------------------
  "insertion.left":  cursorCharLeft,
  "insertion.right": cursorCharRight,
  "insertion.up":    cursorLineUp,
  "insertion.down":  cursorLineDown,
  "edit.enterInsertion": (view: EditorView) =>
    executeEditorCommand(view, { kind: "structural", action: "mode.insert", source: "gamepad" }),
  "edit.exitInsertion": (view: EditorView) =>
    executeEditorCommand(view, { kind: "structural", action: "mode.structural", source: "gamepad" }),
};

// ---------------------------------------------------------------------------
// Lookup helper
// ---------------------------------------------------------------------------

/**
 * Retrieve the handler for an action, or `undefined` if the action has no
 * editor handler (e.g. gamepad-only or picker actions).
 */
export function getHandler(id: ActionId): ActionHandler | undefined {
  return handlers[id];
}

// Re-export the registry for testing / introspection
export { handlers };
