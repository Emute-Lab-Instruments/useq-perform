// src/editors/holeFocusEmitter.ts
//
// Detects when the cursor lands on a hole node after navigation or mutation,
// and publishes the holeFocused event on the contracts channel.
//
// Usage: call `checkAndPublishHoleFocus(view, source)` after any operation
// that may move the cursor onto a hole (navigation, menu apply, fillHole).

import type { EditorView } from "@codemirror/view";
import { getHoleAtCursor } from "./extensions/structure/ast.ts";
import { holeFocused } from "../contracts/editorChannels";
import type { HoleFocusedDetail } from "../contracts/editorChannels";

/**
 * Check whether the cursor is currently on a hole node. If so, publish
 * a `holeFocused` event with the hole's metadata and the trigger source.
 *
 * @param view - The CodeMirror editor view (provides current state).
 * @param source - Whether this check was triggered by a chain (post-mutation)
 *                 or by manual navigation.
 * @returns The parsed hole detail if a hole was found, null otherwise.
 */
export function checkAndPublishHoleFocus(
  view: EditorView,
  source: HoleFocusedDetail["source"],
): HoleFocusedDetail | null {
  const hole = getHoleAtCursor(view.state);
  if (!hole) return null;

  const detail: HoleFocusedDetail = {
    name: hole.name,
    type: hole.type,
    from: hole.from,
    to: hole.to,
    source,
  };

  holeFocused.publish(detail);
  return detail;
}
