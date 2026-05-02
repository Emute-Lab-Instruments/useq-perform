/**
 * Action dispatcher for the structural-editing core.
 *
 * `dispatchAction(view, name)` runs a named structural op against the editor.
 * Currently supported actions (names follow structural-editing.md exactly):
 *
 *   Nav:    nav.out, nav.in (§5.1.1, §5.1.2)
 *           nav.next, nav.prev, nav.first, nav.last (§5.1.3, §5.1.4)
 *           nav.extendNext, nav.extendPrev, nav.shrink (§5.1.5, §5.1.6)
 *           nav.nextHole, nav.prevHole (§5.1.8)
 *   Mutate: edit.slurpForward, edit.slurpBackward,
 *           edit.barfForward, edit.barfBackward,
 *           edit.raise, edit.splice,
 *           edit.transposeNext, edit.transposePrev,
 *           edit.encloseList/Vector/Map/Set
 *
 * Reserved for future spatial implementations (not yet wired):
 *   nav.up, nav.down (§5.1.10 — vertical line-based; needs source positions)
 *   nav.left, nav.right (§5.1.9 — Euler-tour horizontal)
 *   nav.intoMeta (§5.1.7)
 *
 * Other names log a warning and no-op. The mutation factory is created lazily
 * the first time we see a mutating action, with an id generator local to the
 * adapter — the core treats ids as opaque, so any monotonic source is fine.
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
