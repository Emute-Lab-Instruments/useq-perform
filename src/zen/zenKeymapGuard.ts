import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import type { ActionId } from "../lib/keybindings/actions";
import { defaultKeyBindings } from "../lib/keybindings/defaults";
import type { ActionGate } from "./zenNavigation";

const ZEN_RELEVANT_ACTIONS = new Set<string>([
  "edit.slurpFwd",
  "edit.slurpBack",
  "edit.barfFwd",
  "edit.barfBack",
  "edit.delete",
  "edit.raise",
  "edit.splice",
  "edit.wrapList",
  "edit.wrapVector",
  "edit.transposeFwd",
  "edit.transposeBack",
  "nav.up",
  "nav.down",
  "nav.left",
  "nav.right",
  "nav.in",
  "nav.out",
  "nav.home",
  "nav.end",
]);

export function createZenKeymapGuard(gate: ActionGate): Extension {
  const guardBindings = defaultKeyBindings
    .filter((b) => ZEN_RELEVANT_ACTIONS.has(b.action))
    .map((b) => ({
      key: b.key,
      run: () => {
        if (gate(b.action as ActionId) === "block") {
          return true;
        }
        return false;
      },
    }));

  return Prec.highest(keymap.of(guardBindings));
}
