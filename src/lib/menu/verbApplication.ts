// Selection resolution and structural mutation for one radial-menu verb.
// Lifecycle concerns (closing and auto-chain reopening) stay with the caller.

import type { EditorView } from "@codemirror/view";

import type { ActionId } from "../keybindings/actions";
import { structField } from "../../editors/extensions/structure/adapter/stateField";
import type { CursorSet, IdGen, Tree } from "../../editors/extensions/structure/core/types";
import { subPhase } from "./state";
import { applyVerb } from "./verbs";
import { applyTreeMutation } from "./editorTarget";
import type {
  FrozenSnapshot,
  Handedness,
  Manifest,
  MenuItem,
  MenuState,
  Verb,
  VerbKind,
} from "./types";

export type MenuVerbApplication =
  | { readonly kind: "ignored" }
  | { readonly kind: "rejected" }
  | { readonly kind: "committed"; readonly tree: Tree; readonly cursorSet: CursorSet };

export interface MenuVerbApplicationRequest {
  readonly state: MenuState;
  readonly manifest: Manifest | null;
  readonly view: EditorView | undefined;
  readonly verbKind: VerbKind;
  readonly ids: IdGen;
}

export function applyMenuVerb(request: MenuVerbApplicationRequest): MenuVerbApplication {
  const { state, manifest, view, verbKind, ids } = request;
  if (state.phase !== "open" || subPhase(state) !== "frozen" || state.frozen === null) {
    return { kind: "ignored" };
  }
  if (manifest === null || !view) return { kind: "ignored" };

  const item = resolveItem(manifest, state.frozen);
  if (item === null) return { kind: "ignored" };

  const hand: Handedness = state.shoulderHeld === "none" ? "left" : state.shoulderHeld;
  const verb: Verb = { kind: verbKind, hand };
  const structValue = view.state.field(structField, false);
  if (!structValue) return { kind: "ignored" };

  const result = applyVerb({
    tree: structValue.state.tree,
    cursorSet: structValue.state.cursors,
    item,
    verb,
    ids,
  });
  if (!result.ok) return { kind: "rejected" };

  applyTreeMutation(view, structValue, structValue.state.tree, result.tree);
  return { kind: "committed", tree: result.tree, cursorSet: result.cursorSet };
}

export function actionToVerbKind(action: ActionId): VerbKind | null {
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

function resolveItem(manifest: Manifest, frozen: FrozenSnapshot): MenuItem | null {
  const tab = manifest.tabs[frozen.leftTabIdx];
  if (!tab) return null;
  const category = tab.categories.find((candidate) => candidate.id === frozen.leftPicked);
  if (!category) return null;
  return category.items.find((candidate) => candidate.id === frozen.rightPicked) ?? null;
}
