/**
 * Editor keyboard helpers — bracket balancing, documentation lookup,
 * font size, and panel toggle wrappers used by keymap bindings.
 *
 * Extracted from the former editorConfig.ts so that evaluation logic
 * lives separately in src/effects/editorEvaluation.ts.
 */

import type { EditorView } from "@codemirror/view";
import { deleteCharForward } from "@codemirror/commands";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { applyEditorFontSize } from "../lib/editorStore.ts";
import { referenceSearchChannel } from "../ui/help/helpChannels.ts";
import { dbg } from "../lib/debug.ts";
import { toggleVisualisationPanel } from "../ui/adapters/visualisationPanel";

// ---------------------------------------------------------------------------
// Panel toggles
// ---------------------------------------------------------------------------

export function toggleHelp(): boolean {
  import("../ui/adapters/panels.tsx")
    .then((m) => m.togglePanelVisibility("help"))
    .catch(() => {});
  return true;
}

export function toggleSerialVis(): boolean {
  dbg("Toggling serial visualization");
  return toggleVisualisationPanel();
}

// ---------------------------------------------------------------------------
// Documentation
// ---------------------------------------------------------------------------

export function showDocumentationForSymbol(view: EditorView): boolean {
  if (!view || !view.state) return false;

  const state = view.state;
  const { from, to } = state.selection.main;

  let symbol = "";
  if (from !== to) {
    symbol = state.doc.sliceString(from, to).trim();
  } else {
    const cursor = from;
    const line = state.doc.lineAt(cursor);
    const lineText = line.text;
    let start = cursor - line.from;
    let end = start;

    while (start > 0 && /[\w\-!?*+<>=]/.test(lineText.charAt(start - 1))) {
      start -= 1;
    }
    while (end < lineText.length && /[\w\-!?*+<>=]/.test(lineText.charAt(end))) {
      end += 1;
    }

    if (start < end) {
      symbol = lineText.substring(start, end);
    }
  }

  if (!symbol) return false;

  referenceSearchChannel.publish({ symbol });

  return true;
}

// ---------------------------------------------------------------------------
// Font size
// ---------------------------------------------------------------------------

export function setFontSize(editor: EditorView | null, size: number): void {
  if (!editor) return;
  applyEditorFontSize(editor, size);
}

// ---------------------------------------------------------------------------
// Bracket balancing
// ---------------------------------------------------------------------------

const openingBracketChars = ["(", "[", "{"];
const closingBracketChars = [")", "]", "}"];
const bracketChars = openingBracketChars.concat(closingBracketChars);

export function areMatchingBracketChars(char1: string, char2: string): boolean {
  const idx1 = openingBracketChars.indexOf(char1);
  if (idx1 >= 0) {
    return char2 === closingBracketChars[idx1];
  }
  const idx2 = closingBracketChars.indexOf(char1);
  if (idx2 >= 0) {
    return char2 === openingBracketChars[idx2];
  }
  return false;
}

export function makeDeleteWrapper(
  originalRun: (view: EditorView) => boolean,
): (view: EditorView) => boolean {
  return (view: EditorView): boolean => {
    const userSettings = getAppSettings();
    const preventUnbalancing =
      userSettings.editor?.preventBracketUnbalancing ?? true;
    dbg("Delete wrapper - prevent unbalancing setting:", preventUnbalancing);

    if (!preventUnbalancing) {
      dbg("Bracket prevention DISABLED, using normal deletion");
      return originalRun(view);
    }

    dbg("Bracket prevention ENABLED, checking brackets");

    const { state } = view;
    const { from } = state.selection.main;

    const nextChar = state.doc.sliceString(from, from + 1);
    if (bracketChars.includes(nextChar)) {
      const prevChar = state.doc.sliceString(from - 1, from);
      if (areMatchingBracketChars(prevChar, nextChar)) {
        dbg("matching brackets");
        view.dispatch({
          changes: { from: from - 1, to: from, insert: "" },
        });
        deleteCharForward(view);
        return true;
      } else {
        return originalRun(view);
      }
    }
    return originalRun(view);
  };
}
