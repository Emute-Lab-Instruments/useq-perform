// CodeMirror decorations, gutter markers, and view plugins for structure extensions.

import {
  Annotation,
  RangeSetBuilder,
  StateField,
  type EditorState,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";

import {
  getSerialVisPalette,
  getSerialVisChannelColor,
} from "../../../lib/visualisationUtils.ts";
import { visualisationSessionChannel } from "../../../contracts/visualisationChannels";
import {
  getAppSettings,
  subscribeAppSettings,
} from "../../../runtime/appSettingsRepository.ts";
import {
  isExpressionVisualised,
  reportExpressionColor,
} from "../../../effects/visualisationSampler.ts";

import { findNodeAt } from "./new-structure.ts";
import { getTrimmedRange, getContainerNodeAt } from "./ast.ts";
import {
  matchPattern,
  expressionEvaluatedAnnotation,
  lastEvaluatedExpressionField,
  findExpressionBounds,
  findExpressionRanges,
  isRangeActive,
  handlePlayExpression,
} from "./eval-integration.ts";

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export const settingsChangedAnnotation = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// Node highlight StateField
// ---------------------------------------------------------------------------

export const nodeHighlightField = StateField.define({
  create(state: EditorState) {
    const selection = state.selection.main;
    const node = findNodeAt(state, selection.from, selection.to);
    const containerNode = getContainerNodeAt(state, selection.from);
    if (!node && !containerNode) return Decoration.none;

    const range = node ? getTrimmedRange(node, state) : null;
    let parentRange: { from: number; to: number } | null = null;
    let parentIsProgram = false;
    const parent: any = containerNode;

    if (parent) {
      parentIsProgram = parent.type.name === "Program";
      parentRange = getTrimmedRange(parent, state);
    }

    const decorations: any[] = [];
    if (range) {
      decorations.push(
        Decoration.mark({ class: "cm-current-node" }).range(range.from, range.to),
      );
    }
    if (parentIsProgram) {
      decorations.push(
        Decoration.mark({ class: "cm-parent-node-editor-area" }).range(
          0,
          state.doc.length,
        ),
      );
    } else if (parentRange) {
      decorations.push(
        Decoration.mark({ class: "cm-parent-node" }).range(
          parentRange.from,
          parentRange.to,
        ),
      );
    }
    decorations.sort((a: any, b: any) => a.from - b.from);
    return decorations.length ? Decoration.set(decorations) : Decoration.none;
  },

  update(deco, tr) {
    if (!tr.docChanged && !tr.selection) return deco;
    try {
      const selection = tr.state.selection.main;
      const node = findNodeAt(tr.state, selection.from, selection.to);
      const containerNode = getContainerNodeAt(tr.state, selection.from);
      if (!node && !containerNode) return Decoration.none;

      const range = node ? getTrimmedRange(node, tr.state) : null;
      let parentRange: { from: number; to: number } | null = null;
      let parentIsProgram = false;
      const parent: any = containerNode;

      if (parent) {
        parentIsProgram = parent.type.name === "Program";
        parentRange = getTrimmedRange(parent, tr.state);
      }

      const decorations: any[] = [];
      if (range) {
        decorations.push(
          Decoration.mark({ class: "cm-current-node" }).range(range.from, range.to),
        );
      }
      if (parentIsProgram) {
        decorations.push(
          Decoration.mark({ class: "cm-parent-node-editor-area" }).range(
            0,
            tr.state.doc.length,
          ),
        );
      } else if (parentRange) {
        decorations.push(
          Decoration.mark({ class: "cm-parent-node" }).range(
            parentRange.from,
            parentRange.to,
          ),
        );
      }
      decorations.sort((a: any, b: any) => a.from - b.from);
      return decorations.length ? Decoration.set(decorations) : Decoration.none;
    } catch (e) {
      console.error("nodeHighlightField update failed", e);
      return Decoration.none;
    }
  },

  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

export function getCurrentPalette(): string[] {
  return getSerialVisPalette();
}

export function getMatchColor(match: RegExpExecArray): string {
  const palette = getCurrentPalette();
  const offset = (getAppSettings()?.visualisation as any)?.circularOffset ?? 0;
  const exprType = `${match[1]}${match[2]}`;
  return getSerialVisChannelColor(exprType, offset, palette as any);
}

// ---------------------------------------------------------------------------
// ExpressionGutterMarker
// ---------------------------------------------------------------------------

export class ExpressionGutterMarker extends GutterMarker {
  color: string;
  isStart: boolean;
  isEnd: boolean;
  isMid: boolean;
  isActive: boolean;
  exprType: string | null;
  showPlayButton: boolean;
  isVisualised: boolean;

  constructor(
    color: string,
    isStart = false,
    isEnd = false,
    isMid = false,
    isActive = true,
    exprType: string | null = null,
    showPlayButton = false,
    isVisualised = false,
  ) {
    super();
    this.color = color;
    this.isStart = isStart;
    this.isEnd = isEnd;
    this.isMid = isMid;
    this.isActive = isActive;
    this.exprType = exprType;
    this.showPlayButton = showPlayButton;
    this.isVisualised = isVisualised;
  }

  toDOM(): HTMLElement {
    const div = document.createElement("div");
    div.style.cssText = `
      position: relative;
      width: 16px;
      height: 100%;
      margin-left: 2px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-start;
    `;
    div.style.pointerEvents = "auto";
    const baseColor = this.color || "var(--accent-color, #00ff41)";

    if (this.isStart || this.isMid || this.isEnd) {
      const line = document.createElement("div");
      const opacity = this.isActive ? "1.0" : "0.3";
      line.style.cssText = `
        position: absolute;
        left: 50%;
        transform: translateX(-50%);
        width: 4px;
        background-color: ${baseColor};
        opacity: ${opacity};
        height: 100%;
      `;
      line.style.pointerEvents = "none";
      div.appendChild(line);
    }

    if (this.showPlayButton && this.exprType) {
      const btn = document.createElement("span");
      btn.className = "cm-expr-play-btn";
      btn.dataset.expr = this.exprType;
      btn.textContent = "\u25B6";
      btn.title = this.isVisualised
        ? `Stop visualising ${this.exprType}`
        : `Play ${this.exprType}`;
      btn.setAttribute("aria-pressed", this.isVisualised ? "true" : "false");

      const bg = this.isVisualised ? baseColor : "rgba(0, 0, 0, 0.45)";
      let fg = this.isVisualised ? "#080808" : baseColor;
      if (this.isVisualised) {
        try {
          const hex = baseColor.startsWith("#") ? baseColor.substring(1) : null;
          if (hex && (hex.length === 6 || hex.length === 3)) {
            const hx =
              hex.length === 3
                ? hex
                    .split("")
                    .map((c) => c + c)
                    .join("")
                : hex;
            const r = parseInt(hx.substring(0, 2), 16);
            const g = parseInt(hx.substring(2, 4), 16);
            const b = parseInt(hx.substring(4, 6), 16);
            const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
            fg = luminance > 140 ? "#000" : "#fff";
          } else {
            fg = "#fff";
          }
        } catch (_e) {
          fg = "#fff";
        }
      }

      if (this.isVisualised) {
        btn.classList.add("is-visualising");
      }

      btn.style.cssText = `
        position: absolute;
        left: 50%;
        top: 38%;
        transform: translate(-50%, -50%);
        width: 14px;
        height: 14px;
        line-height: 14px;
        text-align: center;
        font-size: 10px;
        font-weight: bold;
        cursor: pointer;
        user-select: none;
        color: ${fg};
        background: ${bg};
        border-radius: 4px;
        z-index: 5;
        display: flex;
        align-items: center;
        justify-content: center;
        border: 1px solid ${baseColor};
        box-shadow: ${this.isVisualised ? "0 0 6px rgba(0,0,0,0.35)" : "none"};
      `;
      btn.style.pointerEvents = "auto";
      div.appendChild(btn);
    }

    return div;
  }

  eq(other: ExpressionGutterMarker): boolean {
    return (
      other instanceof ExpressionGutterMarker &&
      other.color === this.color &&
      other.isStart === this.isStart &&
      other.isEnd === this.isEnd &&
      other.isMid === this.isMid &&
      other.isActive === this.isActive &&
      other.exprType === this.exprType &&
      other.showPlayButton === this.showPlayButton &&
      other.isVisualised === this.isVisualised
    );
  }
}

// ---------------------------------------------------------------------------
// Marker creation helpers
// ---------------------------------------------------------------------------

/** Pure: create gutter markers for a single expression range. */
export function createMarkersForRange(
  range: { color: string; from: number; to: number },
  isActive: boolean,
  docLineFn: (line: number) => { from: number },
  exprType: string,
): Array<{ pos: number; marker: ExpressionGutterMarker }> {
  const markers: Array<{ pos: number; marker: ExpressionGutterMarker }> = [];
  const midLine = Math.floor((range.from + range.to) / 2);

  for (let line = range.from; line <= range.to; line++) {
    const isStart = line === range.from;
    const isEnd = line === range.to;
    const isMid = !isStart && !isEnd;
    const ui = ((getAppSettings()?.ui) as any) || {};

    const buttonsEnabled = ui.expressionClearButtonEnabled !== false;
    const showPlayButton = buttonsEnabled && line === midLine;

    const marker = new ExpressionGutterMarker(
      range.color,
      isStart,
      isEnd,
      isMid,
      isActive,
      exprType,
      showPlayButton,
      isExpressionVisualised(exprType),
    );
    const lineObj = docLineFn(line);
    markers.push({ pos: lineObj.from, marker });
  }

  return markers;
}

/** Pure: process all expression ranges and create sorted markers. */
export function processExpressionRanges(
  expressionRanges: Map<string, Array<{ color: string; from: number; to: number }>>,
  lastEvaluatedMap: Map<string, { line: number }>,
  docLineFn: (line: number) => { from: number },
): Array<{ pos: number; marker: ExpressionGutterMarker }> {
  const allMarkers: Array<{ pos: number; marker: ExpressionGutterMarker }> = [];

  for (const [expressionType, ranges] of expressionRanges) {
    const lastEval = lastEvaluatedMap.get(expressionType);
    const firstRange = ranges && ranges.length > 0 ? ranges[0] : null;
    reportExpressionColor(expressionType, firstRange ? firstRange.color : null);

    for (const range of ranges) {
      const active = isRangeActive(range, lastEval);
      const markers = createMarkersForRange(range, active, docLineFn, expressionType);
      allMarkers.push(...markers);
    }
  }

  allMarkers.sort((a, b) => a.pos - b.pos);
  return allMarkers;
}

// ---------------------------------------------------------------------------
// Expression gutter StateField
// ---------------------------------------------------------------------------

function buildMarkers(state: EditorState): any {
  const builder = new RangeSetBuilder<ExpressionGutterMarker>();
  const doc = state.doc;
  const ui = ((getAppSettings()?.ui) as any) || {};
  if (ui.expressionGutterEnabled === false) {
    return builder.finish();
  }
  const lastEvaluatedRaw: Map<string, { from: number; to: number; line: number }> =
    state.field(lastEvaluatedExpressionField, false) || new Map();
  const lastEvaluated =
    ui.expressionLastTrackingEnabled === false ? new Map() : lastEvaluatedRaw;

  const docLines: Array<{ text: string; from: number }> = [];
  for (let line = 1; line <= doc.lines; line++) {
    docLines.push(doc.line(line));
  }

  const expressionRanges = findExpressionRanges(
    docLines,
    (matchStart) => findExpressionBounds(state, matchStart),
    getMatchColor,
  );

  const markers = processExpressionRanges(
    expressionRanges,
    lastEvaluated,
    (lineNum) => doc.line(lineNum),
  );

  for (const { pos, marker } of markers) {
    builder.add(pos, pos, marker);
  }

  return builder.finish();
}

const expressionGutterField = StateField.define({
  create(state: EditorState) {
    return buildMarkers(state);
  },
  update(markers, tr) {
    if (tr.docChanged) {
      return buildMarkers(tr.state);
    }
    const prevMap = tr.startState.field(lastEvaluatedExpressionField, false);
    const nextMap = tr.state.field(lastEvaluatedExpressionField, false);
    if (prevMap !== nextMap) {
      return buildMarkers(tr.state);
    }
    const settingsChanged = tr.annotation(settingsChangedAnnotation);
    if (settingsChanged) {
      return buildMarkers(tr.state);
    }
    return markers;
  },
});

// ---------------------------------------------------------------------------
// Click handler ViewPlugin
// ---------------------------------------------------------------------------

const expressionClearClickPlugin = ViewPlugin.fromClass(
  class {
    private view: EditorView;
    private onClick: (e: MouseEvent) => void;
    private removeSettingsListener: () => void;
    private removeVisualisationListener: () => void;

    constructor(view: EditorView) {
      this.view = view;
      this.onClick = this._onClick.bind(this);
      this.removeSettingsListener = subscribeAppSettings(() =>
        this.onSettingsChange(),
      );
      this.removeVisualisationListener = visualisationSessionChannel.subscribe(
        () => this.onVisualisationChange(),
      );
      view.dom.addEventListener("click", this.onClick);
    }

    destroy() {
      this.view.dom.removeEventListener("click", this.onClick);
      this.removeSettingsListener();
      this.removeVisualisationListener();
    }

    update(_update: ViewUpdate) {}

    private _onClick(e: MouseEvent) {
      const target = e.target;
      if (!(target instanceof HTMLElement)) return;

      const playBtn = target.closest(".cm-expr-play-btn");
      if (playBtn) {
        const ui = ((getAppSettings()?.ui) as any) || {};
        if (ui.expressionClearButtonEnabled === false) return;
        e.preventDefault();
        e.stopPropagation();
        const exprType = (playBtn as HTMLElement).getAttribute("data-expr");
        if (!exprType) return;
        handlePlayExpression(this.view, exprType);
      }
    }

    private onSettingsChange() {
      try {
        this.view.dispatch({
          annotations: settingsChangedAnnotation.of(true),
        });
      } catch (_e) {}
    }

    private onVisualisationChange() {
      try {
        this.view.dispatch({
          annotations: settingsChangedAnnotation.of(true),
        });
      } catch (_e) {}
    }
  },
);

// ---------------------------------------------------------------------------
// Expression gutter extension
// ---------------------------------------------------------------------------

export const expressionGutter = gutter({
  class: "cm-expression-gutter",
  markers: (v) => v.state.field(expressionGutterField),
  initialSpacer: () =>
    new ExpressionGutterMarker("#transparent", false, false, false, true),
  domEventHandlers: {},
});

// ---------------------------------------------------------------------------
// Bundled extensions array
// ---------------------------------------------------------------------------

export { expressionGutterField, expressionClearClickPlugin };
