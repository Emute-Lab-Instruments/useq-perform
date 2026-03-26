// CodeMirror decorations, gutter markers, and view plugins for structure extensions.

import {
  Annotation,
  type Extension,
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

interface LineBounds {
  lineNumber: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function getLineContentRange(text: string): { start: number; end: number } {
  let start = 0;
  while (start < text.length && text[start] === ' ') start++;
  let end = text.length;
  while (end > start && text[end - 1] === ' ') end--;
  return { start, end };
}

function computeNodeLineBounds(
  view: EditorView,
  nodeFrom: number,
  nodeTo: number,
): LineBounds[] {
  const doc = view.state.doc;
  const firstLine = doc.lineAt(nodeFrom);
  const lastLine = doc.lineAt(nodeTo);
  const charWidth = view.defaultCharacterWidth;
  const minPadCols = 2;
  const scrollRect = view.scrollDOM.getBoundingClientRect();

  const entries: Array<{ line: any; lineNum: number; block: any; start: number; end: number }> = [];
  let globalMinCol = Infinity;

  for (let lineNum = firstLine.number; lineNum <= lastLine.number; lineNum++) {
    const line = doc.line(lineNum);
    const { start, end } = getLineContentRange(line.text);
    const block = view.lineBlockAt(line.from);
    entries.push({ line, lineNum, block, start, end });
    if (start < end && start < globalMinCol) {
      globalMinCol = start;
    }
  }

  if (globalMinCol === Infinity) {
    globalMinCol = 0;
  }

  const leftCoords = view.coordsAtPos(firstLine.from + globalMinCol, -1);
  const baseLeft = leftCoords ? leftCoords.left - scrollRect.left : globalMinCol * charWidth;

  return entries.map(({ line, lineNum, block, start, end }) => {
    let rightX: number;
    if (start < end) {
      const rightCoords = view.coordsAtPos(line.from + end, 1);
      rightX = rightCoords ? rightCoords.right - scrollRect.left : end * charWidth;
    } else {
      rightX = baseLeft + minPadCols * charWidth;
    }

    return {
      lineNumber: lineNum,
      left: baseLeft,
      right: rightX,
      top: block.top,
      bottom: block.bottom,
    };
  });
}

function groupLineBounds(lines: LineBounds[]): LineBounds[][] {
  if (lines.length === 0) return [];
  const groups: LineBounds[][] = [];
  let currentGroup: LineBounds[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].lineNumber === lines[i - 1].lineNumber + 1) {
      currentGroup.push(lines[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [lines[i]];
    }
  }
  groups.push(currentGroup);
  return groups;
}

function buildPolygonPath(group: LineBounds[], padding: number = 2): string {
  if (group.length === 0) return '';
  const P = padding;
  const lines = group.map(lb => ({
    left: lb.left - P,
    right: lb.right + P,
    top: lb.top - P,
    bottom: lb.bottom + P,
  }));
  const pts: [number, number][] = [];

  pts.push([lines[0].right, lines[0].top]);
  for (let i = 0; i < lines.length - 1; i++) {
    const curr = lines[i];
    const next = lines[i + 1];
    if (next.right !== curr.right) {
      const stepY = (curr.bottom + next.top) / 2;
      pts.push([curr.right, stepY]);
      pts.push([next.right, stepY]);
    }
  }
  pts.push([lines[lines.length - 1].right, lines[lines.length - 1].bottom]);

  pts.push([lines[lines.length - 1].left, lines[lines.length - 1].bottom]);
  for (let i = lines.length - 1; i > 0; i--) {
    const curr = lines[i];
    const prev = lines[i - 1];
    if (prev.left !== curr.left) {
      const stepY = (curr.top + prev.bottom) / 2;
      pts.push([curr.left, stepY]);
      pts.push([prev.left, stepY]);
    }
  }
  pts.push([lines[0].left, lines[0].top]);
  return 'M' + pts.map(([x, y]) => `${x},${y}`).join('L') + 'Z';
}

interface NodeRangeData {
  nodeFrom: number;
  nodeTo: number;
  parentFrom: number | null;
  parentTo: number | null;
  parentIsProgram: boolean;
}

interface PolygonData {
  pathD: string;
  isCurrent: boolean;
}

interface LineData {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

interface NodeHighlightMeasure {
  nodeRange: NodeRangeData | null;
  polygons: PolygonData[];
  parentLines: LineData[];
  scrollTop: number;
}

class NodeHighlightPluginClass {
  private svgOverlay: SVGSVGElement;
  private view: EditorView;

  constructor(view: EditorView) {
    this.view = view;
    this.svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.svgOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 0;
      overflow: visible;
    `;
    view.scrollDOM.appendChild(this.svgOverlay);
    this.scheduleMeasure();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (update.docChanged || update.selectionSet || update.viewportChanged || update.geometryChanged) {
      this.scheduleMeasure();
    }
  }

  destroy(): void {
    this.svgOverlay.remove();
  }

  private scheduleMeasure(): void {
    const self = this;
    this.view.requestMeasure({
      read(view: EditorView): NodeHighlightMeasure {
        const scrollTop = view.scrollDOM.scrollTop;
        const selection = view.state.selection.main;
        const node = findNodeAt(view.state, selection.from, selection.to);
        const containerNode = getContainerNodeAt(view.state, selection.from);

        if (!node && !containerNode) {
          return { nodeRange: null, polygons: [], parentLines: [], scrollTop };
        }

        const range = node ? getTrimmedRange(node, view.state) : null;
        const parent: any = containerNode;
        let parentRange: { from: number; to: number } | null = null;
        let parentIsProgram = false;
        if (parent) {
          parentIsProgram = parent.type.name === "Program";
          parentRange = getTrimmedRange(parent, view.state);
        }

        const nodeRange: NodeRangeData = {
          nodeFrom: range?.from ?? -1,
          nodeTo: range?.to ?? -1,
          parentFrom: parentRange?.from ?? null,
          parentTo: parentRange?.to ?? null,
          parentIsProgram,
        };

        const polygons: PolygonData[] = [];

        if (nodeRange.nodeFrom >= 0) {
          const lineBounds = computeNodeLineBounds(view, nodeRange.nodeFrom, nodeRange.nodeTo);
          if (lineBounds.length > 0) {
            const blocks = groupLineBounds(lineBounds);
            for (const block of blocks) {
              const pathD = buildPolygonPath(block, 3);
              if (pathD) {
                polygons.push({ pathD, isCurrent: true });
              }
            }
          }
        }

        const parentLines: LineData[] = [];
        if (nodeRange.parentFrom !== null && nodeRange.parentTo !== null && !nodeRange.parentIsProgram) {
          const parentLineBounds = computeNodeLineBounds(view, nodeRange.parentFrom, nodeRange.parentTo);
          if (parentLineBounds.length > 0) {
            const lastLine = parentLineBounds[parentLineBounds.length - 1];
            parentLines.push({
              x1: lastLine.left - 3,
              y1: lastLine.bottom + 2,
              x2: lastLine.right + 3,
              y2: lastLine.bottom + 2,
            });
          }
        }

        return { nodeRange, polygons, parentLines, scrollTop };
      },
      write(measure: NodeHighlightMeasure) {
        self.renderPolygons(measure.polygons, measure.parentLines);
      },
    });
  }

  private renderPolygons(polygons: PolygonData[], parentLines: LineData[]): void {
    while (this.svgOverlay.firstChild) {
      this.svgOverlay.removeChild(this.svgOverlay.firstChild);
    }

    const scrollWidth = this.view.scrollDOM.scrollWidth;
    const scrollHeight = this.view.scrollDOM.scrollHeight;
    this.svgOverlay.setAttribute('width', String(scrollWidth));
    this.svgOverlay.setAttribute('height', String(scrollHeight));

    for (const poly of polygons) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', poly.pathD);
      path.setAttribute('fill', 'rgba(255, 100, 150, 0.15)');
      path.setAttribute('stroke', 'rgba(255, 80, 130, 0.7)');
      path.setAttribute('stroke-width', '2');
      this.svgOverlay.appendChild(path);
    }

    for (const line of parentLines) {
      const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
      lineEl.setAttribute('x1', String(line.x1));
      lineEl.setAttribute('y1', String(line.y1));
      lineEl.setAttribute('x2', String(line.x2));
      lineEl.setAttribute('y2', String(line.y2));
      lineEl.setAttribute('stroke', 'rgba(100, 255, 100, 0.4)');
      lineEl.setAttribute('stroke-width', '2');
      lineEl.setAttribute('stroke-dasharray', '6 4');
      this.svgOverlay.appendChild(lineEl);
    }
  }
}

export const nodeHighlightPlugin = ViewPlugin.fromClass(NodeHighlightPluginClass);

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
        try {
          this.view.dispatch({
            annotations: settingsChangedAnnotation.of(true),
          });
        } catch (_e) {}
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
