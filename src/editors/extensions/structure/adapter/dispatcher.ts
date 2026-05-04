/**
 * Action dispatcher for the structural-editing core.
 *
 * `dispatchAction(view, name)` runs a named structural op against the editor.
 * Currently supported actions (names follow structural-editing.md exactly):
 *
 *   Spatial (primary):
 *           nav.right, nav.left (§5.1.1 — Euler-tour horizontal)
 *           nav.up, nav.down (§5.1.2 — vertical spatial; lives in the
 *             adapter because it needs source positions)
 *   Tree-level (secondary):
 *           nav.out, nav.in (§5.1.3, §5.1.4)
 *           nav.next, nav.prev, nav.first, nav.last (§5.1.5, §5.1.6)
 *           nav.extendNext, nav.extendPrev, nav.shrink (§5.1.7, §5.1.8)
 *           nav.nextHole, nav.prevHole (§5.1.10)
 *   Mutate: edit.slurpForward, edit.slurpBackward,
 *           edit.barfForward, edit.barfBackward,
 *           edit.raise, edit.splice,
 *           edit.transposeNext, edit.transposePrev, edit.delete,
 *           edit.encloseList/Vector/Map/Set
 *
 * Reserved for future spatial implementations (not yet wired):
 *   nav.intoMeta (§5.1.7)
 *
 * Other names log a warning and no-op. The mutation factory is created lazily
 * the first time we see a mutating action, with an id generator local to the
 * adapter — the core treats ids as opaque, so any monotonic source is fine.
 *
 * Most ops are pure tree ops with type `(s: State) => OpResult` and are
 * dispatched through `applyOp`. Spatial vertical nav (`nav.up`, `nav.down`)
 * doesn't fit that shape — it needs an `EditorView` directly to read source
 * positions — so it takes a parallel direct-dispatch path.
 */

import type { EditorView } from "@codemirror/view";

import {
  defaultIdGen,
  makeMutators,
  nav,
  type Mutators,
  type State,
} from "../core/index.ts";
import { applyOp } from "./applyOp.ts";
import { navDown, navUp } from "./spatialNav.ts";
import { getAppSettings } from "../../../../runtime/appSettingsRepository.ts";
import { formatNode } from "./printTree.ts";
import { setStructState, structField } from "./stateField.ts";
import { pathsFromCursorSet } from "./cursorPath.ts";
import { treeFromLezer } from "./treeFromLezer.ts";
import { vectorController } from "../../liveEdit/markAction.ts";

let _mutators: Mutators | null = null;
function getMutators(): Mutators {
  if (_mutators === null) {
    _mutators = makeMutators({
      ids: defaultIdGen("a"),
      atomSlurpBehaviour: "promote-to-vector",
    });
  }
  return _mutators;
}

type Op = (s: State) => import("../core/index.ts").OpResult;

function actionOp(name: string): Op | null {
  switch (name) {
    case "nav.out":       return nav.out;
    case "nav.in":        return nav.in;
    case "nav.next":      return nav.next;
    case "nav.prev":      return nav.prev;
    case "nav.first":     return nav.first;
    case "nav.last":      return nav.last;
    case "nav.extendNext": return nav.extendNext;
    case "nav.extendPrev": return nav.extendPrev;
    case "nav.shrink":    return nav.shrink;
    case "nav.nextHole":  return nav.nextHole;
    case "nav.prevHole":  return nav.prevHole;
    case "nav.right":     return nav.right;
    case "nav.left":      return nav.left;

    case "edit.slurpForward":  return (s) => getMutators().slurpForward(s);
    case "edit.slurpBackward": return (s) => getMutators().slurpBackward(s);
    case "edit.barfForward":   return (s) => getMutators().barfForward(s);
    case "edit.barfBackward":  return (s) => getMutators().barfBackward(s);
    case "edit.raise":         return (s) => getMutators().raise(s);
    case "edit.splice":        return (s) => getMutators().splice(s);
    case "edit.transposeNext": return (s) => getMutators().transposeNext(s);
    case "edit.transposePrev": return (s) => getMutators().transposePrev(s);
    case "edit.delete":        return (s) => getMutators().delete(s);
    case "edit.encloseList":   return (s) => getMutators().enclose.list(s);
    case "edit.encloseVector": return (s) => getMutators().enclose.vector(s);
    case "edit.encloseMap":    return (s) => getMutators().enclose.map(s);
    case "edit.encloseSet":    return (s) => getMutators().enclose.set(s);

    default:
      return null;
  }
}

/**
 * Reformat the top-level form containing the primary cursor.
 * This is a presentation-only change — the structural tree is NOT mutated;
 * the state field stays intact after the doc-change re-parse.
 */
function formatTopLevel(view: EditorView): boolean {
  const value = view.state.field(structField, false);
  if (!value) return false;

  const { state, idIndex } = value;
  const fmt = getAppSettings().format;

  // Find which top-level form contains the primary cursor.
  const primary = state.cursors.primary;
  const targetId = primary.kind === "node" ? primary.target : primary.parent;

  // Walk up to find the top-level child of the document root.
  const docChildren = state.tree.root.children;
  let topLevelChild: import("../core/index.ts").Node | null = null;

  // First try: is the cursor directly on a top-level form?
  for (const child of docChildren) {
    if (child.id === targetId) {
      topLevelChild = child;
      break;
    }
  }

  // If not found directly, find the top-level ancestor by source range containment.
  if (!topLevelChild) {
    const targetRange = idIndex.get(targetId);
    if (targetRange) {
      for (const child of docChildren) {
        const childRange = idIndex.get(child.id);
        if (
          childRange &&
          childRange.from <= targetRange.from &&
          childRange.to >= targetRange.to
        ) {
          topLevelChild = child;
          break;
        }
      }
    }
  }

  if (!topLevelChild) return false;

  const range = idIndex.get(topLevelChild.id);
  if (!range) return false;

  const formatted = formatNode(topLevelChild, fmt);
  const current = view.state.doc.sliceString(range.from, range.to);
  if (formatted === current) return false; // no change needed

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: formatted },
    userEvent: "format.topLevel",
    scrollIntoView: true,
  });

  // After re-parse, preserve cursor by re-applying the current cursor paths.
  const { tree, idIndex: newIdIndex } = treeFromLezer(view.state);
  view.dispatch({
    effects: setStructState.of({
      state: { tree, cursors: state.cursors },
      idIndex: newIdIndex,
      cursorPaths: pathsFromCursorSet(state.cursors, state.tree),
    }),
  });

  return true;
}

/**
 * Reformat all top-level forms in the document, preserving inter-top-level
 * whitespace exactly (spec §2.1).
 */
function formatDocument(view: EditorView): boolean {
  const value = view.state.field(structField, false);
  if (!value) return false;

  const { state, idIndex } = value;
  const fmt = getAppSettings().format;
  const docText = view.state.doc.toString();
  const docChildren = state.tree.root.children;

  if (docChildren.length === 0) return false;

  // Collect source ranges and formatted text for each top-level form.
  const entries: Array<{ from: number; to: number; formatted: string }> = [];
  for (const child of docChildren) {
    const range = idIndex.get(child.id);
    if (!range) continue;
    const formatted = formatNode(child, fmt);
    const current = docText.slice(range.from, range.to);
    if (formatted !== current) {
      entries.push({ from: range.from, to: range.to, formatted });
    }
  }

  if (entries.length === 0) return false; // nothing changed

  // Build changes from last to first to keep offsets stable.
  const changes = entries
    .slice()
    .reverse()
    .map(({ from, to, formatted }) => ({ from, to, insert: formatted }));

  view.dispatch({
    changes,
    userEvent: "format.document",
    scrollIntoView: true,
  });

  // After re-parse, preserve cursor.
  const { tree, idIndex: newIdIndex } = treeFromLezer(view.state);
  view.dispatch({
    effects: setStructState.of({
      state: { tree, cursors: state.cursors },
      idIndex: newIdIndex,
      cursorPaths: pathsFromCursorSet(state.cursors, state.tree),
    }),
  });

  return true;
}

/** Run the named action against the editor. Returns true on dispatch. */
export function dispatchAction(view: EditorView, name: string): boolean {
  // ── Vector-mark sub-mode interception (live-edit.md §3.7.3) ──────────
  // When the vector-mark controller is active, nav.next/prev/right/left
  // move between markable elements instead of normal structural nav.
  // liveEdit.vectorConfirm and liveEdit.vectorCancel are also handled here.
  if (vectorController.active) {
    switch (name) {
      case "nav.next":
      case "nav.right":
        vectorController.next(view);
        return true;
      case "nav.prev":
      case "nav.left":
        vectorController.prev(view);
        return true;
      case "liveEdit.vectorConfirm":
        vectorController.commit(view);
        return true;
      case "liveEdit.vectorCancel":
        vectorController.cancel(view);
        return true;
    }
  }

  // Spatial vertical nav takes the view directly (it needs source positions
  // that the pure core doesn't carry — see spatialNav.ts).
  if (name === "nav.up") return navUp(view);
  if (name === "nav.down") return navDown(view);

  // Format actions operate directly on the editor without a tree mutation.
  if (name === "format.topLevel") return formatTopLevel(view);
  if (name === "format.document") return formatDocument(view);

  const op = actionOp(name);
  if (op === null) {
    console.warn(`[structure] unknown action: ${name}`);
    return false;
  }
  return applyOp(view, op);
}

/** Names the dispatcher knows about. Useful for the gamepad bridge. */
export const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
  "nav.out",
  "nav.in",
  "nav.next",
  "nav.prev",
  "nav.first",
  "nav.last",
  "nav.extendNext",
  "nav.extendPrev",
  "nav.shrink",
  "nav.nextHole",
  "nav.prevHole",
  "nav.right",
  "nav.left",
  "nav.up",
  "nav.down",
  "edit.slurpForward",
  "edit.slurpBackward",
  "edit.barfForward",
  "edit.barfBackward",
  "edit.raise",
  "edit.splice",
  "edit.transposeNext",
  "edit.transposePrev",
  "edit.delete",
  "edit.encloseList",
  "edit.encloseVector",
  "edit.encloseMap",
  "edit.encloseSet",
  "format.topLevel",
  "format.document",
  "liveEdit.vectorConfirm",
  "liveEdit.vectorCancel",
]);
