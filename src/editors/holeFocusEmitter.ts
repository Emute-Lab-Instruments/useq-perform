// src/editors/holeFocusEmitter.ts
//
// Detects when the cursor lands on a hole node after navigation or mutation,
// and publishes the holeFocused event on the contracts channel.
//
// Usage: call `checkAndPublishHoleFocus(view, source)` after any operation
// that may move the cursor onto a hole (navigation, menu apply, fillHole).
//
// Reads the structural-editing core's state field (`structField`) to find
// the hole at the primary cursor — no Lezer/regex re-parse.

import type { EditorView } from "@codemirror/view";
import { findById } from "./extensions/structure/core/index.ts";
import type { HoleNode } from "./extensions/structure/core/index.ts";
import { structField } from "./extensions/structure/adapter/stateField.ts";
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
  const value = view.state.field(structField, false);
  if (!value) return null;

  const primary = value.state.cursors.primary;
  if (primary.kind !== "node") return null;

  const node = findById(value.state.tree.root, primary.target);
  if (!node || node.kind !== "hole") return null;

  const hole = node as HoleNode;
  const range = value.idIndex.get(hole.id);
  if (!range) return null;

  const detail: HoleFocusedDetail = {
    name: hole.name,
    type: hole.holeType,
    from: range.from,
    to: range.to,
    source,
  };

  holeFocused.publish(detail);
  return detail;
}
