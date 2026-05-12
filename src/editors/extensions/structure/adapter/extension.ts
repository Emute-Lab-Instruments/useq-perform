/**
 * Bundled CodeMirror extensions for the new structural-editing core.
 *
 * `structuralCoreExtensions()` returns the array to add to the editor's
 * extension list. The state field auto-installs and decorations follow.
 *
 * Note: keymaps are NOT part of this bundle. The gamepad pipeline reaches
 * structural ops via `nav.up`/`nav.down`/`nav.left`/`nav.right` ActionIds
 * routed through the keybindings handler registry → `dispatchAction`.
 */

import type { Extension } from "@codemirror/state";

import { structuralCursorFromSelection } from "./cursorFromSelection.ts";
import { holePillDecorations, holePillTheme } from "./holeWidget.ts";
import { indentOnNewlineChange } from "./indentOnNewline.ts";
import {
  structuralNodeOverlay,
  structuralNodeOverlayTheme,
} from "./nodeOverlays.ts";
import { grabModeField, insertionModeField, structField } from "./stateField.ts";

export function structuralCoreExtensions(): Extension[] {
  return [
    structField,
    insertionModeField,
    grabModeField,
    structuralCursorFromSelection,
    structuralNodeOverlay,
    structuralNodeOverlayTheme,
    holePillDecorations,
    holePillTheme,
    indentOnNewlineChange,
  ];
}

export { dispatchAction } from "./dispatcher.ts";
