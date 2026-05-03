/**
 * Editor keyboard helpers — bracket balancing, documentation lookup,
 * font size, and panel toggle wrappers used by keymap bindings.
 *
 * Extracted from the former editorConfig.ts so that evaluation logic
 * lives separately in src/effects/editorEvaluation.ts.
 */

import type { EditorView } from "@codemirror/view";
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

