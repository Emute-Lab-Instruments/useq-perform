import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import type { EditorView } from "@codemirror/view";
import { keymap } from "@codemirror/view";
import { Prec } from "@codemirror/state";
import { historyKeymap, deleteCharBackward } from "@codemirror/commands";
import { evaluate } from "../effects/editorEvaluation.ts";
import {
  toggleHelp,
  toggleSerialVis,
  showDocumentationForSymbol,
  makeDeleteWrapper,
} from "./editorKeyboard.ts";
import {
  contractCurrentProbeContext,
  expandCurrentProbeContext,
  toggleCurrentProbe,
} from "./extensions/probes.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";

// Modified keybindings to improve usability
const completeKeymapModified = completeClojureKeymap.map((binding: any) => {
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
export const useq_keymap = [
  { key: "Mod-Enter", run: (view: EditorView) => evaluate(view, "expression") },
  { key: "Alt-Enter", run: (view: EditorView) => evaluate(view, "toplevel") },
  { key: "Mod-Shift-Enter", run: (view: EditorView) => evaluate(view, "soft") },
  {
    key: "Alt-/",
    run: toggleHelp,
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
  {
    key: "Alt-p",
    run: (view: EditorView) => toggleCurrentProbe(view, "contextual"),
    preventDefault: true,
    stopPropagation: true,
  },
  {
    key: "Alt-Shift-p",
    run: (view: EditorView) => toggleCurrentProbe(view, "raw"),
    preventDefault: true,
    stopPropagation: true,
  },
  {
    key: "Alt-h",
    run: expandCurrentProbeContext,
    preventDefault: true,
    stopPropagation: true,
  },
  {
    key: "Alt-s",
    run: contractCurrentProbeContext,
    preventDefault: true,
    stopPropagation: true,
  },
];

// Structural navigation keymap for code structure traversal
export const structural_navigation_keymap = [
  // { 
  //   key: "Alt-ArrowLeft", 
  //   run: navigatePrev,
  //   preventDefault: true,
  //   stopPropagation: true
  // },
  // { 
  //   key: "Alt-ArrowRight", 
  //   run: navigateNext,
  //   preventDefault: true,
  //   stopPropagation: true
  // },
  // { 
  //   key: "Alt-ArrowUp", 
  //   run: navigateOut,
  //   preventDefault: true,
  //   stopPropagation: true
  // },
  // { 
  //   key: "Alt-ArrowDown", 
  //   run: navigateIn,
  //   preventDefault: true,
  //   stopPropagation: true
  // }
];

export let baseKeymap = [
  // Highest precedence Backspace gate: when prevention is disabled,
  // bypass clojure-mode's close_brackets Backspace handler.
  Prec.highest(keymap.of([
    {
      key: "Backspace",
      run: (view) => {
        const prevent = getAppSettings().editor?.preventBracketUnbalancing ?? true;
        if (!prevent) {
          // Feature disabled: perform normal backspace and stop propagation
          return deleteCharBackward(view);
        }
        // Feature enabled: let lower keymaps (clojure-mode) handle it
        return false;
      },
    },
  ])),
  keymap.of(useq_keymap),
  keymap.of(structural_navigation_keymap),
  keymap.of(completeKeymapModified),
  keymap.of(historyKeymap),
];

// iterate over baseKeymap and print each map
// baseKeymap.forEach((map) => {
//   console.log("Keymap:", map.value);
// });

export let mainEditorKeymap = [baseKeymap];
