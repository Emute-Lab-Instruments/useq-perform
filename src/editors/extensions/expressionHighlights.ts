// Expression-evaluation feedback decorations: gutter pills, play-button DOM,
// expression colours. Pure code-evaluation feedback — no structural-AST
// coupling. Reads expression ranges from the Lezer tree via `eval-state.ts`
// helpers (`findExpressionBounds` / `findExpressionRanges`).
//
// Previously bundled inside `structure/decorations.ts` alongside the legacy
// cursor-halo plugin; split out so the structural-editing layer can be
// retired without dragging the gutter with it.

import {
  Annotation,
  type Extension,
  RangeSetBuilder,
  StateField,
  type EditorState,
} from "@codemirror/state";
import {
  EditorView,
  GutterMarker,
  ViewPlugin,
  gutter,
  type ViewUpdate,
} from "@codemirror/view";

import {
  getSerialVisPalette,
  getSerialVisChannelColor,
} from "../../lib/visualisationUtils.ts";
import { visualisationSessionChannel } from "../../contracts/visualisationChannels";
import {
  getAppSettings,
  subscribeAppSettings,
} from "../../runtime/appSettingsRepository.ts";
import {
  isExpressionVisualised,
  reportExpressionColor,
} from "../../effects/visualisationSampler.ts";

import {
  lastEvaluatedExpressionField,
  findExpressionBounds,
  findExpressionRanges,
  isRangeActive,
} from "./expressionEvalState.ts";
import { handlePlayExpression } from "./expressionEval.ts";

// ---------------------------------------------------------------------------
// GutterConfig — dependency injection interface
// ---------------------------------------------------------------------------

/**
 * Configuration for the expression gutter system.
 * Each field is a specific capability the gutter needs — no app-wide settings objects.
 */
export interface GutterConfig {
  /** Whether the expression gutter is enabled (read on each rebuild) */
  isGutterEnabled: () => boolean;
  /** Whether play/clear buttons appear on gutter markers (read on each marker creation) */
  isClearButtonEnabled: () => boolean;
  /** Whether "last evaluated" tracking highlights are shown */
  isLastTrackingEnabled: () => boolean;
  /** Get the color for a matched expression (e.g., 'a1', 'd3') */
  getExpressionColor: (match: RegExpExecArray) => string;
  /** Check if an expression is currently being visualised */
  isVisualised: (exprType: string, position: { from: number; to: number }) => boolean;
  /** Report the resolved color for an expression type (for external UI sync) */
  reportColor: (exprType: string, color: string | null) => void;
  /** Handle play button click on an expression */
  onPlayExpression: (view: EditorView, exprType: string) => void;
  /** Subscribe to external changes that should trigger gutter rebuild. Returns unsubscribe function. */
  onExternalChange: (callback: () => void) => () => void;
}

// ---------------------------------------------------------------------------
// Annotations
// ---------------------------------------------------------------------------

export const settingsChangedAnnotation = Annotation.define<boolean>();

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function getCurrentPalette(): string[] {
  return getSerialVisPalette();
}

function getMatchColor(match: RegExpExecArray): string {
  const palette = getCurrentPalette();
  const offset = (getAppSettings()?.visualisation as any)?.circularOffset ?? 0;
  const exprType = `${match[1]}${match[2]}`;
  return getSerialVisChannelColor(exprType, offset, palette as any) ?? '#888';
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
      btn.textContent = "▶";
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
  isClearButtonEnabled: () => boolean,
  isVisualisedFn: (exprType: string, position: { from: number; to: number }) => boolean,
): Array<{ pos: number; marker: ExpressionGutterMarker }> {
  const markers: Array<{ pos: number; marker: ExpressionGutterMarker }> = [];
  const midLine = Math.floor((range.from + range.to) / 2);
  const position = { from: range.from, to: range.to };

  for (let line = range.from; line <= range.to; line++) {
    const isStart = line === range.from;
    const isEnd = line === range.to;
    const isMid = !isStart && !isEnd;

    const buttonsEnabled = isClearButtonEnabled();
    const showPlayButton = buttonsEnabled && line === midLine;

    const marker = new ExpressionGutterMarker(
      range.color,
      isStart,
      isEnd,
      isMid,
      isActive,
      exprType,
      showPlayButton,
      isVisualisedFn(exprType, position),
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
  reportColorFn: (exprType: string, color: string | null) => void,
  isClearButtonEnabled: () => boolean,
  isVisualisedFn: (exprType: string, position: { from: number; to: number }) => boolean,
): Array<{ pos: number; marker: ExpressionGutterMarker }> {
  const allMarkers: Array<{ pos: number; marker: ExpressionGutterMarker }> = [];

  for (const [expressionType, ranges] of expressionRanges) {
    const lastEval = lastEvaluatedMap.get(expressionType);
    const firstRange = ranges && ranges.length > 0 ? ranges[0] : null;
    reportColorFn(expressionType, firstRange ? firstRange.color : null);

    for (const range of ranges) {
      const active = isRangeActive(range, lastEval);
      const markers = createMarkersForRange(range, active, docLineFn, expressionType, isClearButtonEnabled, isVisualisedFn);
      allMarkers.push(...markers);
    }
  }

  allMarkers.sort((a, b) => a.pos - b.pos);
  return allMarkers;
}

// ---------------------------------------------------------------------------
// Expression gutter factory
// ---------------------------------------------------------------------------

/**
 * Create expression gutter extensions with explicit configuration.
 * Returns [gutterField, clickPlugin, gutter] as an array of extensions.
 */
export function createExpressionGutter(config: GutterConfig): Extension[] {
  let buildingMarkers = false;

  function buildMarkers(state: EditorState): any {
    const builder = new RangeSetBuilder<ExpressionGutterMarker>();
    const doc = state.doc;
    if (!config.isGutterEnabled()) {
      return builder.finish();
    }
    const lastEvaluatedRaw: Map<string, { from: number; to: number; line: number }> =
      state.field(lastEvaluatedExpressionField, false) || new Map();
    const lastEvaluated =
      !config.isLastTrackingEnabled() ? new Map() : lastEvaluatedRaw;

    const docLines: Array<{ text: string; from: number }> = [];
    for (let line = 1; line <= doc.lines; line++) {
      docLines.push(doc.line(line));
    }

    const expressionRanges = findExpressionRanges(
      docLines,
      (matchStart) => findExpressionBounds(state, matchStart),
      config.getExpressionColor,
    );

    buildingMarkers = true;
    try {
      const markers = processExpressionRanges(
        expressionRanges,
        lastEvaluated,
        (lineNum) => doc.line(lineNum),
        config.reportColor,
        config.isClearButtonEnabled,
        config.isVisualised,
      );

      for (const { pos, marker } of markers) {
        builder.add(pos, pos, marker);
      }
    } finally {
      buildingMarkers = false;
    }

    return builder.finish();
  }

  const gutterField = StateField.define({
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

  const clickPlugin = ViewPlugin.fromClass(
    class {
      private view: EditorView;
      private onClick: (e: MouseEvent) => void;
      private removeExternalListener: () => void;
      private rafPending = 0;

      constructor(view: EditorView) {
        this.view = view;
        this.onClick = this._onClick.bind(this);
        this.removeExternalListener = config.onExternalChange(() =>
          this.onExternalChange(),
        );
        view.dom.addEventListener("click", this.onClick);
      }

      destroy() {
        this.view.dom.removeEventListener("click", this.onClick);
        this.removeExternalListener();
        if (this.rafPending) cancelAnimationFrame(this.rafPending);
      }

      update(_update: ViewUpdate) {}

      private _onClick(e: MouseEvent) {
        const target = e.target;
        if (!(target instanceof HTMLElement)) return;

        const playBtn = target.closest(".cm-expr-play-btn");
        if (playBtn) {
          if (!config.isClearButtonEnabled()) return;
          e.preventDefault();
          e.stopPropagation();
          const exprType = (playBtn as HTMLElement).getAttribute("data-expr");
          if (!exprType) return;
          config.onPlayExpression(this.view, exprType);
        }
      }

      private onExternalChange() {
        if (this.rafPending) return;
        this.rafPending = requestAnimationFrame(() => {
          this.rafPending = 0;
          if (buildingMarkers) return;
          if (!this.view.dom?.isConnected) return;
          try {
            this.view.dispatch({
              annotations: settingsChangedAnnotation.of(true),
            });
          } catch (_) {
            // View in a bad state — swallow silently; next rAF will retry.
          }
        });
      }
    },
  );

  const gutterExt = gutter({
    class: "cm-expression-gutter",
    markers: (v) => v.state.field(gutterField),
    initialSpacer: () =>
      new ExpressionGutterMarker("#transparent", false, false, false, true),
    domEventHandlers: {},
  });

  return [gutterField, clickPlugin, gutterExt];
}

// ---------------------------------------------------------------------------
// Default config — backward-compatible wrapper using global state
// ---------------------------------------------------------------------------

/** Default config that reads from the app's global state (backward-compatible). */
export function createDefaultGutterConfig(): GutterConfig {
  return {
    isGutterEnabled: () => ((getAppSettings()?.ui) as any)?.expressionGutterEnabled !== false,
    isClearButtonEnabled: () => ((getAppSettings()?.ui) as any)?.expressionClearButtonEnabled !== false,
    isLastTrackingEnabled: () => ((getAppSettings()?.ui) as any)?.expressionLastTrackingEnabled !== false,
    getExpressionColor: (match: RegExpExecArray) => getMatchColor(match),
    isVisualised: (exprType, position) => isExpressionVisualised(exprType, position),
    reportColor: (exprType, color) => reportExpressionColor(exprType, color),
    onPlayExpression: (view, exprType) => handlePlayExpression(view, exprType),
    onExternalChange: (callback) => {
      const unsub1 = subscribeAppSettings(callback);
      const unsub2 = visualisationSessionChannel.subscribe(callback);
      return () => { unsub1(); unsub2(); };
    },
  };
}
