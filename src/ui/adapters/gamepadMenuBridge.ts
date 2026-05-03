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
import { holeFocused } from "../../contracts/editorChannels";
import type { HoleFocusedDetail, HoleType } from "../../contracts/editorChannels";

import { open as openDoubleRadialMenu } from "./double-radial-menu.tsx";
import { buildHierarchicalMenuModel } from "../../lib/pickerMenuModel.ts";
import {
  showHierarchicalGridPicker,
  showNumberPickerMenu,
} from "./picker-menu.tsx";

import {
  findNodeAt,
  getTrimmedRange,
} from "../../editors/extensions/lezerHelpers.ts";
import { checkAndPublishHoleFocus } from "../../editors/holeFocusEmitter.ts";
import { executeEditorCommand } from "../../editors/commands/editorCommandRouter.ts";

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
          executeEditorCommand(view, {
            kind: "replaceRange",
            from,
            to,
            insert: symbol,
            selectionAnchor: from + symbol.length,
            scrollIntoView: true,
            userEvent: "replace.picker",
            source: "menu",
          });
          break;

        case "apply_call": {
          const funcCall = ` (${symbol} _)`;
          executeEditorCommand(view, {
            kind: "replaceRange",
            from: to,
            to,
            insert: funcCall,
            selectionAnchor: to + funcCall.indexOf("_"),
            scrollIntoView: true,
            userEvent: "insert.call.picker",
            source: "menu",
          });
          break;
        }

        case "apply_pre":
          executeEditorCommand(view, {
            kind: "replaceRange",
            from,
            to: from,
            insert: symbol + " ",
            selectionAnchor: from,
            scrollIntoView: true,
            userEvent: "insert.before.picker",
            source: "menu",
          });
          break;

        case "apply":
        default:
          executeEditorCommand(view, {
            kind: "replaceRange",
            from: to,
            to,
            insert: " " + symbol,
            selectionAnchor: to + 1,
            scrollIntoView: true,
            userEvent: "insert.after.picker",
            source: "menu",
          });
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error?.(
        `[gamepadMenuBridge] Error applying selection: ${message}`
      );
      executeEditorCommand(view, {
        kind: "replaceRange",
        from: view.state.selection.main.from,
        to: view.state.selection.main.to,
        insert: text,
        selectionAnchor: view.state.selection.main.from + text.length,
        scrollIntoView: true,
        userEvent: "insert.picker.fallback",
        source: "menu",
      });
    }

    pickerDirection = null;
    closeMenuFn = null;
    setMode("normal");
    hideEditorCursor(view);

    // Auto-chain: after applying a menu selection, check if the cursor now
    // sits on a hole. If so, publish holeFocused with source "chain" so the
    // subscriber can re-open the menu scoped to the hole type.
    checkAndPublishHoleFocus(view, "chain");
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
      if (getMode() === "picker" || getMode() === "loading-picker" || getMode() === "number-picker") {
        logger.debug?.(
          "[gamepadMenuBridge] Picker already open; ignoring create menu request"
        );
        return;
      }

      // If cursor is on a number hole, open numpad instead of radial menu
      const holeDetail = checkAndPublishHoleFocus(view, "navigation");
      if (holeDetail && holeDetail.type === "number") {
        openNumpadForHole(holeDetail);
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

  // -- Numpad helper (shared by holeFocused auto-chain and openRadialMenu) ---

  function openNumpadForHole(detail: HoleFocusedDetail): void {
    setMode("number-picker");
    closeMenuFn = showNumberPickerMenu({
      title: `Fill ⟨${detail.name}⟩`,
      onSelect: (value: number) => {
        if (!view) {
          cancelAction();
          return;
        }
        // Replace the hole source text with the entered number literal
        const literal = formatNumberLiteral(value);
        executeEditorCommand(view, {
          kind: "replaceRange",
          from: detail.from,
          to: detail.to,
          insert: literal,
          selectionAnchor: detail.from + literal.length,
          scrollIntoView: true,
          userEvent: "replace.numpad",
          source: "menu",
        });
        pickerDirection = null;
        closeMenuFn = null;
        setMode("normal");
        hideEditorCursor(view);
        // Auto-chain: check for next hole after filling
        checkAndPublishHoleFocus(view, "chain");
      },
    });
  }

  // -- Hole focus subscriber (auto-chain re-open) ---------------------------
  //
  // When the cursor lands on a hole via chain (post-mutation), auto-open the
  // menu scoped to the hole's :type. Manual navigation does NOT auto-open —
  // the user must tap Y explicitly.
  //
  // Type mapping (per radial-menu.md §8.2.1):
  //   :number  → number picker (numpad)
  //   :symbol  → symbols tab
  //   :keyword → literals tab, keywords category
  //   :expr    → skip auto-open (user taps Y)

  const unsubHoleFocused = holeFocused.subscribe(async (detail: HoleFocusedDetail) => {
    // Only auto-open for chain-originated events
    if (detail.source !== "chain") return;

    // Skip auto-open for :expr and unknown types — user taps Y manually
    if (detail.type === "expr") return;

    // Don't open if a picker is already active
    if (getMode() === "picker" || getMode() === "loading-picker" || getMode() === "number-picker") {
      return;
    }

    // :number holes get a dedicated numpad entry surface
    if (detail.type === "number") {
      openNumpadForHole(detail);
      return;
    }

    setMode("loading-picker");
    const categories = await typedBuildHierarchicalMenuModel();

    if (getMode() !== "loading-picker") return;

    // Scope the menu based on hole type
    const scopedCategories = scopeCategoriesToHoleType(categories, detail.type);

    closeMenuFn = openDoubleRadialMenu({
      categories: scopedCategories as unknown as import("../DoubleRadialPicker.tsx").PickerCategory[],
      title: `Fill ⟨${detail.name}⟩`,
      onSelect: (entry: PickerEntry) =>
        handleCreateSelection(entry, "replace"),
      onCancel: () => cancelAction(),
    });

    pickerDirection = "replace";
    setMode("picker");
  });

  return {
    dispose(): void {
      unsubOpenMenu();
      unsubOpenRadialMenu();
      unsubPickerCancel();
      unsubHoleFocused();
      cancelAction();
    },
  };
}

// ---------------------------------------------------------------------------
// Number literal formatting
// ---------------------------------------------------------------------------

/**
 * Format a numeric value as a clean literal string for insertion into source.
 * Strips trailing zeros after the decimal point but preserves integer form.
 */
function formatNumberLiteral(value: number): string {
  if (Number.isNaN(value)) return "0";
  if (!Number.isFinite(value)) return value > 0 ? "999999" : "-999999";
  // Use toPrecision to avoid floating-point noise, then parseFloat to strip trailing zeros
  const str = String(parseFloat(value.toPrecision(10)));
  return str;
}

// ---------------------------------------------------------------------------
// Hole-type scoping
// ---------------------------------------------------------------------------

/**
 * Filter/reorder the hierarchical menu categories based on hole type.
 * Returns a narrowed view of the manifest appropriate for the given hole type.
 */
function scopeCategoriesToHoleType(
  categories: HierarchicalCategory[],
  holeType: HoleType,
): HierarchicalCategory[] {
  switch (holeType) {
    case "number": {
      // Show numbers/literals categories first; filter to numeric items
      const numericCategories = categories.filter(
        (c) =>
          c.id?.toLowerCase().includes("literal") ||
          c.id?.toLowerCase().includes("number") ||
          c.label?.toLowerCase().includes("literal") ||
          c.label?.toLowerCase().includes("number")
      );
      // If we found specific categories, use them; otherwise show all
      return numericCategories.length > 0 ? numericCategories : categories;
    }

    case "symbol": {
      // Show symbols/functions categories
      const symbolCategories = categories.filter(
        (c) =>
          c.id?.toLowerCase().includes("symbol") ||
          c.id?.toLowerCase().includes("function") ||
          c.label?.toLowerCase().includes("symbol") ||
          c.label?.toLowerCase().includes("function")
      );
      return symbolCategories.length > 0 ? symbolCategories : categories;
    }

    case "keyword": {
      // Show literals tab, keywords category
      const keywordCategories = categories.filter(
        (c) =>
          c.id?.toLowerCase().includes("keyword") ||
          c.id?.toLowerCase().includes("literal") ||
          c.label?.toLowerCase().includes("keyword") ||
          c.label?.toLowerCase().includes("literal")
      );
      return keywordCategories.length > 0 ? keywordCategories : categories;
    }

    case "string": {
      // Show string/text entry categories
      const stringCategories = categories.filter(
        (c) =>
          c.id?.toLowerCase().includes("string") ||
          c.id?.toLowerCase().includes("text") ||
          c.id?.toLowerCase().includes("literal") ||
          c.label?.toLowerCase().includes("string") ||
          c.label?.toLowerCase().includes("text") ||
          c.label?.toLowerCase().includes("literal")
      );
      return stringCategories.length > 0 ? stringCategories : categories;
    }

    case "expr":
    default:
      // Show everything — user picks any tab
      return categories;
  }
}
