// Post-commit menu lifecycle planning. The chain runner discovers the next
// target; this module translates that result into reducer inputs.

import type { CursorSet, Tree } from "../../editors/extensions/structure/core/types";
import { nextChainStep } from "./chain";
import type { Manifest, MenuInput } from "./types";

export function postVerbMenuInputs(
  tree: Tree,
  cursorSet: CursorSet,
  manifest: Manifest | null,
): readonly MenuInput[] {
  const inputs: MenuInput[] = [{ kind: "cancel" }];
  const step = nextChainStep(tree, cursorSet, true);
  if (step.reopen && manifest !== null) {
    inputs.push({ kind: "open", target: step.target, manifest });
  }
  return inputs;
}
