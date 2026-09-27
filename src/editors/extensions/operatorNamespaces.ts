import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { hoverTooltip, EditorView, type Tooltip } from "@codemirror/view";
import type { Extension } from "@codemirror/state";

import { ensureReferenceDataLoaded, referenceStore } from "../../utils/referenceStore.ts";
import { buildNamespacePickerItems } from "../../lib/pickerMenuModel.ts";
import {
  namespaceHint,
  namespaceSpans,
  operatorName,
} from "../../lib/operatorNamespaces.ts";
import { pushOverlay } from "../../ui/overlayManager.ts";
import { getAppSettings } from "../../runtime/appSettingsRepository.ts";

interface SymbolRange {
  from: number;
  to: number;
  text: string;
}

function symbolAt(view: EditorView, position: number): SymbolRange | null {
  const line = view.state.doc.lineAt(position);
  const local = position - line.from;
  const isSymbol = (character: string): boolean =>
    character.length > 0 && !/[\s()[\]{}"',;]/.test(character);
  let from = local;
  let to = local;
  while (from > 0 && isSymbol(line.text[from - 1])) from--;
  while (to < line.text.length && isSymbol(line.text[to])) to++;
  if (from === to) return null;
  return { from: line.from + from, to: line.from + to, text: line.text.slice(from, to) };
}

function entryForSymbol(symbol: string) {
  const base = operatorName(symbol);
  return referenceStore.data.find((entry) => entry.name === base || entry.name === symbol) ?? null;
}

function namespaceCompletion(context: CompletionContext): CompletionResult | null {
  const token = context.matchBefore(/[^\s()[\]{}"',;]*/);
  if (!token || (!context.explicit && token.from === token.to)) return null;
  const text = token.text;
  const slash = text.indexOf("/");

  if (slash >= 0) {
    const prefix = text.slice(0, slash);
    const definition = referenceStore.namespaces.find(
      (candidate) => candidate.name === prefix || candidate.longName === prefix,
    );
    if (!definition) return null;
    const typedOperator = text.slice(slash + 1);
    const options = referenceStore.data.flatMap((entry) =>
      entry.namespaceApplicability.some((cell) => cell.namespace === definition.name) &&
      operatorName(entry.name).startsWith(typedOperator)
        ? [{
            label: `${prefix}/${operatorName(entry.name)}`,
            type: "function",
            detail: entry.namespaceApplicability.find((cell) => cell.namespace === definition.name)?.identity,
          }]
        : [],
    );
    return options.length > 0 ? { from: token.from, options } : null;
  }

  const entry = referenceStore.data.find((candidate) => candidate.name === text);
  if (!entry) return null;
  const options = entry.namespaceApplicability.map((cell) => ({
    label: cell.spelling,
    type: "function",
    detail: cell.identity,
  }));
  return options.length > 0 ? { from: token.from, options } : null;
}

function namespaceTooltip(view: EditorView, position: number): Tooltip | null {
  const range = symbolAt(view, position);
  if (!range) return null;
  const spans = namespaceSpans(range.text);
  const entry = entryForSymbol(range.text);
  if (!entry) return null;
  if (!spans) {
    if (!getAppSettings().ui.namespaceHintsVerbose || !entry.bareIdentity) return null;
    return {
      pos: range.from,
      end: range.to,
      above: true,
      create() {
        const dom = document.createElement("div");
        dom.className = "cm-namespace-tooltip";
        dom.textContent = `${entry.name} ≡ ${entry.bareIdentity}`;
        return { dom };
      },
    };
  }
  if (position < range.from + spans.namespace.from || position > range.from + spans.namespace.to) return null;
  const hint = namespaceHint(range.text, entry, referenceStore.namespaces);
  if (!hint) return null;
  return {
    pos: range.from,
    end: range.from + spans.namespace.to,
    above: true,
    create() {
      const dom = document.createElement("div");
      dom.className = "cm-namespace-tooltip";
      const title = document.createElement("strong");
      title.textContent = hint.title;
      const semantics = document.createElement("div");
      semantics.textContent = hint.semantics;
      const identity = document.createElement("div");
      identity.textContent = `${operatorName(range.text)} here: ${hint.identity}`;
      dom.append(title, semantics, identity);
      return { dom };
    },
  };
}

function closePicker(menu: HTMLElement, popOverlay: () => void): void {
  menu.remove();
  popOverlay();
}

export function openNamespacePicker(
  view: EditorView,
  position = view.state.selection.main.head,
  coordinates?: { x: number; y: number },
): boolean {
  const range = symbolAt(view, position);
  if (!range) return false;
  const entry = entryForSymbol(range.text);
  if (!entry || entry.namespaceApplicability.length === 0) return false;
  const items = buildNamespacePickerItems(range.text, entry, referenceStore.namespaces);
  if (items.length === 0) return false;

  const menu = document.createElement("div");
  menu.className = "cm-namespace-picker";
  menu.setAttribute("role", "menu");
  const coords = coordinates ?? view.coordsAtPos(range.from) ?? { left: 0, bottom: 0 };
  const x = "x" in coords ? coords.x : coords.left;
  const y = "y" in coords ? coords.y : coords.bottom;
  Object.assign(menu.style, { position: "fixed", left: `${x}px`, top: `${y}px`, zIndex: "1000" });

  let popOverlay = () => {};
  const dismiss = () => closePicker(menu, popOverlay);
  popOverlay = pushOverlay("namespace-picker", dismiss);
  for (const item of items) {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "menuitem");
    button.dataset.current = String(item.current);
    button.title = `${item.semantics}\n${item.identity}`;
    button.textContent = `${item.current ? "✓ " : ""}${item.label} — ${item.identity}`;
    button.addEventListener("click", () => {
      view.dispatch({
        changes: { from: range.from, to: range.to, insert: item.spelling },
        selection: { anchor: range.from, head: range.from + item.spelling.length },
        scrollIntoView: true,
        userEvent: "input.namespace",
      });
      dismiss();
      view.focus();
    });
    menu.append(button);
  }
  document.body.append(menu);
  return true;
}

const clickNamespace = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (event.button !== 0) return false;
    const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (position === null) return false;
    const range = symbolAt(view, position);
    const spans = range ? namespaceSpans(range.text) : null;
    if (!range || !spans || position > range.from + spans.namespace.to) return false;
    event.preventDefault();
    return openNamespacePicker(view, position, { x: event.clientX, y: event.clientY });
  },
});

export function operatorNamespaceExtensions(): Extension[] {
  void ensureReferenceDataLoaded();
  return [
    hoverTooltip(namespaceTooltip),
    autocompletion({ override: [namespaceCompletion] }),
    clickNamespace,
    EditorView.baseTheme({
      ".cm-namespace-tooltip": { padding: "0.45rem 0.6rem", maxWidth: "24rem" },
      ".cm-namespace-picker": {
        display: "grid",
        gap: "0.2rem",
        padding: "0.35rem",
        background: "var(--surface, #20242c)",
        border: "1px solid var(--border, #596273)",
        borderRadius: "0.35rem",
      },
      ".cm-namespace-picker button": {
        color: "inherit",
        background: "transparent",
        border: "0",
        padding: "0.35rem 0.5rem",
        textAlign: "left",
      },
    }),
  ];
}
