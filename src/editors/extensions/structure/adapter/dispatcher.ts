/**
 * Action dispatcher for the structural-editing core.
 *
 * `dispatchAction(view, name)` runs a named structural op against the editor.
 * Round-2 supported actions:
 *
 *   Nav:    nav.up, nav.down, nav.next, nav.prev, nav.first, nav.last
 *   Mutate: edit.slurpForward, edit.slurpBackward,
 *           edit.barfForward, edit.barfBackward,
 *           edit.raise, edit.transposeNext
 *
 * Other names log a warning and no-op. The mutation factory is created lazily
 * the first time we see a mutating action, with an id generator local to the
 * adapter — round 1's core treats ids as opaque, so any monotonic source is
 * fine.
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
    case "nav.up":        return nav.up;
    case "nav.down":      return nav.down;
    case "nav.next":      return nav.next;
    case "nav.prev":      return nav.prev;
    case "nav.first":     return nav.first;
    case "nav.last":      return nav.last;
    case "nav.extendNext": return nav.extendNext;
    case "nav.extendPrev": return nav.extendPrev;
    case "nav.shrink":    return nav.shrink;
    case "nav.nextHole":  return nav.nextHole;
    case "nav.prevHole":  return nav.prevHole;

    case "edit.slurpForward":  return (s) => getMutators().slurpForward(s);
    case "edit.slurpBackward": return (s) => getMutators().slurpBackward(s);
    case "edit.barfForward":   return (s) => getMutators().barfForward(s);
    case "edit.barfBackward":  return (s) => getMutators().barfBackward(s);
    case "edit.raise":         return (s) => getMutators().raise(s);
    case "edit.splice":        return (s) => getMutators().splice(s);
    case "edit.transposeNext": return (s) => getMutators().transposeNext(s);
    case "edit.transposePrev": return (s) => getMutators().transposePrev(s);
    case "edit.encloseList":   return (s) => getMutators().enclose.list(s);
    case "edit.encloseVector": return (s) => getMutators().enclose.vector(s);
    case "edit.encloseMap":    return (s) => getMutators().enclose.map(s);
    case "edit.encloseSet":    return (s) => getMutators().enclose.set(s);

    default:
      return null;
  }
}

/** Run the named action against the editor. Returns true on dispatch. */
export function dispatchAction(view: EditorView, name: string): boolean {
  const op = actionOp(name);
  if (op === null) {
    console.warn(`[structure] unknown action: ${name}`);
    return false;
  }
  return applyOp(view, op);
}

/** Names the dispatcher knows about. Useful for the gamepad bridge. */
export const KNOWN_ACTIONS: ReadonlySet<string> = new Set([
  "nav.up",
  "nav.down",
  "nav.next",
  "nav.prev",
  "nav.first",
  "nav.last",
  "nav.extendNext",
  "nav.extendPrev",
  "nav.shrink",
  "nav.nextHole",
  "nav.prevHole",
  "edit.slurpForward",
  "edit.slurpBackward",
  "edit.barfForward",
  "edit.barfBackward",
  "edit.raise",
  "edit.splice",
  "edit.transposeNext",
  "edit.transposePrev",
  "edit.encloseList",
  "edit.encloseVector",
  "edit.encloseMap",
  "edit.encloseSet",
]);
