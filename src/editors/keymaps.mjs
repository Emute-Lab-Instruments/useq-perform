import { complete_keymap as completeClojureKeymap } from "@nextjournal/clojure-mode";
import { keymap } from "@codemirror/view";
import { sendTouSEQ } from "../io/serialComms.mjs";
import { historyKeymap } from "@codemirror/commands";
import { toggleVid, evalNow, evalQuantised, toggleHelp, toggleSerialVis } from "./editorConfig.mjs";

// Modified keybindings to improve usability
const completeKeymapModified = completeClojureKeymap.map((binding) => {
  switch (binding.key) {
    // Fix Del unbalancing parens
    case "Delete":
      const originalRun = binding.run;
      return {
        ...binding,
        run: (view) => {
          const { state } = view;
          const { from } = state.selection.main;

          const nextChar = state.doc.sliceString(from, from + 1);
          if (bracketChars.includes(nextChar)) {
            const prevChar = state.doc.sliceString(from - 1, from);
            if (areMatchingBracketChars(prevChar, nextChar)) {
              console.log("matching brackets");
              // We're in an empty pair, delete both
              // characters around the cursor
              view.dispatch({
                changes: { from: from - 1, to: from, insert: "" },
              });
              // NOTE: this is needed to avoid a blank space
              // being inserted after the deleted brackets
              deleteCharForward(view);
              return true;
            } else {
              // Next char is a closing bracket in a non-empty
              // expression, do nothing
              return true;
            }
          }
          // Next char isn't a closing bracket, delete normally
          return originalRun(view); // Run the original function
        },
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
];

export let baseKeymap = [
  keymap.of(useq_keymap),
  keymap.of(completeKeymapModified),
  keymap.of(historyKeymap),
];

export let mainEditorKeymap = [baseKeymap];
