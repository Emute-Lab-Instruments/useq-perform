/**
 * Bundled CodeMirror extensions for the new structural-editing core.
 *
 * `structuralCoreExtensions()` returns the array to add to the editor's
 * extension list. The state field auto-installs and decorations follow.
 *
 * The bundle is gated on `settings.structure.useNewCore`. When the flag is
 * false the caller should NOT include this bundle, leaving the legacy
 * structural extensions in place untouched.
 *
 * Note: keymaps and gamepad bindings are NOT part of this bundle. The
 * gamepad bridge is wired separately in `bootstrap.ts`.
 */

import type { Extension } from "@codemirror/state";

import {
  structuralCursorDecorations,
  structuralCursorTheme,
} from "./decorations.ts";
import { holePillDecorations, holePillTheme } from "./holeWidget.ts";
import { structField } from "./stateField.ts";

export function structuralCoreExtensions(): Extension[] {
  return [
    structField,
    structuralCursorDecorations,
    structuralCursorTheme,
    holePillDecorations,
    holePillTheme,
  ];
}

export { dispatchAction } from "./dispatcher.ts";
export { bindStructuralGamepadBridge } from "./gamepadBridge.ts";
export type { GamepadBridgeHandle } from "./gamepadBridge.ts";
