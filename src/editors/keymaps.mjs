import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import { keymap } from "@codemirror/view";
import { sendTouSEQ } from "../io/serialComms.mjs";
import { historyKeymap } from "@codemirror/commands";
import {
  toggleVid,
  evalNow,
  evalQuantised,
  toggleHelp,
  toggleSerialVis,
  toggleDocumentation,
  showDocumentationForSymbol
} from "./editorConfig.mjs";

import { makeDeleteWrapper } from "./editorConfig.mjs";

// Modified keybindings to improve usability
const completeKeymapModified = completeClojureKeymap.map((binding) => {
  switch (binding.key) {
    // Fix Del unbalancing parens
    case "Delete":
      return {
        ...binding,
        run: makeDeleteWrapper(binding.run),
      };
    // Change bindings for slurping and barfing
    // (to avoid using arrows which are intercepted by some OSes)
    case "Ctrl-ArrowRight":
      return { ...binding, key: "Ctrl-]" };
    case "Ctrl-ArrowLeft":
      return { ...binding, key: "Ctrl-[" };
    case "Ctrl-Alt-ArrowLeft":
      return { ...binding, key: "Ctrl-;" };
    case "Ctrl-Alt-ArrowRight":
      return { ...binding, key: "Ctrl-'" };
    default:
      return binding;
  }
});

// Custom keymap for the editor
const useq_keymap = [
  { key: "Ctrl-Enter", run: evalNow },
  { key: "Alt-Enter", run: evalQuantised },
  {
    key: "Alt-h",
    run: toggleHelp,
    preventDefault: true,
    stopPropagation: true,
  },
  {
    key: "Alt-v",
    run: toggleVid,
    preventDefault: true,
    stopPropagation: true,
  },
  {
    key: "Alt-g",
    run: toggleSerialVis,
    preventDefault: true,
    stopPropagation: true,
  },
  {
    key: "Alt-f",
    run: showDocumentationForSymbol,
    preventDefault: true,
    stopPropagation: true,
  },
];

export let baseKeymap = [
  keymap.of(useq_keymap),
  keymap.of(completeKeymapModified),
  keymap.of(historyKeymap),
];

export let mainEditorKeymap = [baseKeymap];
