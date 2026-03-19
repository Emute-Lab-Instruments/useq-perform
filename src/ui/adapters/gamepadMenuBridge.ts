// src/ui/adapters/gamepadMenuBridge.ts
//
// Connects gamepad intent channels to picker/radial menu UI adapters.
// Subscribes to openMenu / openRadialMenu intents, manages picker lifecycle,
// and publishes controllerMode changes so the intent emitter knows whether
// to emit normal-mode or picker-mode intents.

import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";

import * as ch from "../../contracts/gamepadChannels";
import type { ControllerMode } from "../../contracts/gamepadChannels";

import { open as openDoubleRadialMenu } from "./double-radial-menu.tsx";
import { buildHierarchicalMenuModel } from "../../lib/pickerMenuModel.ts";
import {
  showHierarchicalGridPicker,
  showNumberPickerMenu,
} from "./picker-menu.tsx";

import {
  findNodeAt,
} from "../../editors/extensions/structure/new-structure.ts";
import {
  getTrimmedRange,
} from "../../editors/extensions/structure.ts";

import type { PickerEntry } from "../DoubleRadialPicker.tsx";
import type {
  HierarchicalCategory,
  HierarchicalItem,
} from "../HierarchicalPickerMenu.tsx";

// ---------------------------------------------------------------------------
// Typed casts for upstream @ts-nocheck modules
// ---------------------------------------------------------------------------

const typedFindNodeAt = findNodeAt as (
  state: EditorState,
  from: number,
  to?: number
) => SyntaxNode | null;

const typedGetTrimmedRange = getTrimmedRange as (
  node: SyntaxNode,
  state: EditorState
) => { from: number; to: number } | null;

const typedBuildHierarchicalMenuModel = buildHierarchicalMenuModel as () => Promise<
  HierarchicalCategory[]
>;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type MenuEntry = PickerEntry | HierarchicalItem;

interface Logger {
  debug: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

const noop = (): void => {};
const nullLogger: Logger = { debug: noop, error: noop };

export interface GamepadMenuBridgeOptions {
  view: EditorView;
  logger?: Logger;
  onPickerSelect?: ((entry: MenuEntry, index: number, direction: string) => void) | null;
}

export interface GamepadMenuBridgeHandle {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getCursorNode(view: EditorView): SyntaxNode | null {
  if (!view) return null;
  const selection = view.state.selection.main;
  return typedFindNodeAt(view.state, selection.from, selection.to);
}

function hideEditorCursor(view: EditorView): void {
  if (view?.dom) {
    view.dom.classList.add("hide-cursor");
  }
}

// ---------------------------------------------------------------------------
// Bridge
// ---------------------------------------------------------------------------

export function bindGamepadMenuBridge(
  options: GamepadMenuBridgeOptions
): GamepadMenuBridgeHandle {
  const { view } = options;
  const logger = options.logger ?? nullLogger;
  const onPickerSelect = options.onPickerSelect ?? null;

  let mode: ControllerMode = "normal";
  let pickerDirection: string | null = null;
  let closeMenuFn: (() => void) | null = null;

  function setMode(next: ControllerMode): void {
    mode = next;
    ch.controllerMode.publish(next);
  }

  /** Read mode without TypeScript narrowing it away after guards. */
  function getMode(): ControllerMode {
    return mode;
  }

  function cancelAction(): void {
    if (closeMenuFn) {
      closeMenuFn();
      closeMenuFn = null;
    }
    pickerDirection = null;
    setMode("normal");
  }

  // -- Selection handler (shared by grid and radial menus) ------------------

  function handleCreateSelection(entry: MenuEntry, direction: string): void {
    if (onPickerSelect) {
      onPickerSelect(entry, 0, direction);
      pickerDirection = null;
      closeMenuFn = null;
      setMode("normal");
      return;
    }

    if (!view) {
      pickerDirection = null;
      closeMenuFn = null;
      setMode("normal");
      return;
    }

    const text =
      entry && (entry as PickerEntry).insertText
        ? (entry as PickerEntry).insertText!
        : String(entry?.value ?? "");
    if (!text) {
      pickerDirection = null;
      closeMenuFn = null;
      setMode("normal");
      return;
    }

    const applyMode =
      (entry as Record<string, unknown>).applyMode as string | undefined ??
      (direction === "replace"
        ? "replace"
        : direction === "before"
          ? "apply_pre"
          : "apply");
    const symbol = text.trim();

    try {
      const node = getCursorNode(view);
      const range = node
        ? typedGetTrimmedRange(node, view.state)
        : view.state.selection.main;
      const from =
        typeof range?.from === "number"
          ? range.from
          : view.state.selection.main.from;
      const to =
        typeof range?.to === "number"
          ? range.to
          : view.state.selection.main.to;

      switch (applyMode) {
        case "replace":
          view.dispatch({
            changes: { from, to, insert: symbol },
            selection: { anchor: from + symbol.length },
            scrollIntoView: true,
            userEvent: "replace.picker",
          });
          break;

        case "apply_call": {
          const funcCall = ` (${symbol} _)`;
          view.dispatch({
            changes: { from: to, to, insert: funcCall },
            selection: { anchor: to + funcCall.indexOf("_") },
            scrollIntoView: true,
            userEvent: "insert.call.picker",
          });
          break;
        }

        case "apply_pre":
          view.dispatch({
            changes: { from, to: from, insert: symbol + " " },
            selection: { anchor: from },
            scrollIntoView: true,
            userEvent: "insert.before.picker",
          });
          break;

        case "apply":
        default:
          view.dispatch({
            changes: { from: to, to, insert: " " + symbol },
            selection: { anchor: to + 1 },
            scrollIntoView: true,
            userEvent: "insert.after.picker",
          });
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.(
        `[gamepadMenuBridge] Error applying selection: ${message}`
      );
      view.dispatch({
        changes: {
          from: view.state.selection.main.from,
          to: view.state.selection.main.to,
          insert: text,
        },
        selection: {
          anchor: view.state.selection.main.from + text.length,
        },
        scrollIntoView: true,
        userEvent: "insert.picker.fallback",
      });
    }

    pickerDirection = null;
    closeMenuFn = null;
    setMode("normal");
    hideEditorCursor(view);
  }

  // -- Open menu subscribers ------------------------------------------------

  const unsubOpenMenu = ch.openMenu.subscribe(async ({ direction }) => {
    if (getMode() === "picker" || getMode() === "loading-picker") {
      logger.debug?.(
        "[gamepadMenuBridge] Picker already open; ignoring create menu request"
      );
      return;
    }

    setMode("loading-picker");
    const categories = await typedBuildHierarchicalMenuModel();

    if (getMode() !== "loading-picker") return;

    closeMenuFn = showHierarchicalGridPicker({
      categories,
      title: "Create",
      onSelect: (entry: HierarchicalItem) =>
        handleCreateSelection(entry, direction),
    });

    pickerDirection = direction;
    setMode("picker");
  });

  const unsubOpenRadialMenu = ch.openRadialMenu.subscribe(
    async ({ direction }) => {
      if (getMode() === "picker" || getMode() === "loading-picker") {
        logger.debug?.(
          "[gamepadMenuBridge] Picker already open; ignoring create menu request"
        );
        return;
      }

      setMode("loading-picker");
      const categories = await typedBuildHierarchicalMenuModel();

      if (getMode() !== "loading-picker") return;

      closeMenuFn = openDoubleRadialMenu({
        categories: categories as unknown as import("../DoubleRadialPicker.tsx").PickerCategory[],
        title: "Create",
        onSelect: (entry: PickerEntry) =>
          handleCreateSelection(entry, direction),
        onCancel: () => cancelAction(),
      });

      pickerDirection = direction;
      setMode("picker");
    }
  );

  // -- Picker cancel subscriber ---------------------------------------------

  const unsubPickerCancel = ch.pickerCancel.subscribe(() => {
    if (getMode() === "picker" || getMode() === "number-picker") {
      cancelAction();
    }
  });

  return {
    dispose(): void {
      unsubOpenMenu();
      unsubOpenRadialMenu();
      unsubPickerCancel();
      cancelAction();
    },
  };
}
