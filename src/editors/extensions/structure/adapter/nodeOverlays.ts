/**
 * SVG overlay for the structural-cursor visual.
 *
 * Layers, in render order (legacy z-ordering preserved — guides under
 * polygons under parent edges, then cursor clip applied last):
 *
 *   1. Indent guides — vertical dashed lines down the left edge of each
 *      multi-line container ancestor (incl. the focused node when it is a
 *      container).
 *   2. Node polygons — the per-line-block path for the focused node, or
 *      one polygon per range member when the cursor is a range.
 *   3. Parent edge — short horizontal dashed line under the last line of the
 *      immediate parent compound (skipped at the document root and for range
 *      cursors).
 *   4. Cursor clip — clipPath applied to `.cm-cursorLayer` so the CM caret
 *      paints only inside the polygon (or only outside, when at the trailing
 *      edge). Skipped for range cursors.
 *   5. Bracket-match suppression — toggles `.useq-hide-bracket-match` on
 *      `view.dom` whenever any polygon renders.
 *
 * Geometry helpers (`getLineContentRange`, `computeNodeLineBounds`,
 * `groupLineBounds`, `buildPolygonPath`) are transplanted verbatim from the
 * pre-7597b5f legacy implementation and kept module-private here.
 *
 * All measurement happens in one `view.requestMeasure` read pass, all DOM
 * writes happen in the corresponding write pass, and the whole cycle is
 * rAF-debounced.
 */

import { EditorView, ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import type { Line } from "@codemirror/state";

import {
  getAppSettings,
  subscribeAppSettings,
} from "../../../../runtime/appSettingsRepository.ts";

import {
  indexOfChild,
  isCompound,
  parentOf,
  type Cursor,
  type Node,
  type NodeId,
} from "../core/index.ts";
import { structField } from "./stateField.ts";
import type { IdIndex, SourceRange } from "./treeFromLezer.ts";

// ─── Debug logging ───────────────────────────────────────────────────────────

const DEBUG_OVERLAY = false;
const dlog = (...args: unknown[]): void => {
  if (DEBUG_OVERLAY) console.log("[nodeOverlays]", ...args);
};

// ─── Geometry types (private) ────────────────────────────────────────────────

interface LineBounds {
  lineNumber: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
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

interface IndentGuideStyle {
  width: number;
  opacity: number;
  luminosity: number;
  dash: number;
  gap: number;
  yPadding: number;
}

// ─── Geometry helpers (transplanted verbatim from legacy) ────────────────────

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

  const entries: Array<{
    line: Line;
    lineNum: number;
    block: { top: number; bottom: number };
    start: number;
    end: number;
  }> = [];

  for (let lineNum = firstLine.number; lineNum <= lastLine.number; lineNum++) {
    const line = doc.line(lineNum);
    // Clamp start/end to the node's actual range within each line
    let start: number, end: number;
    if (lineNum === firstLine.number && lineNum === lastLine.number) {
      // Single-line node: use exact node bounds
      start = nodeFrom - line.from;
      end = nodeTo - line.from;
    } else if (lineNum === firstLine.number) {
      // First line of multi-line: start at node, end at line content end
      start = nodeFrom - line.from;
      end = getLineContentRange(line.text).end;
    } else if (lineNum === lastLine.number) {
      // Last line of multi-line: start at line content start, end at node
      start = getLineContentRange(line.text).start;
      end = nodeTo - line.from;
    } else {
      // Middle lines: full line content
      ({ start, end } = getLineContentRange(line.text));
    }
    const block = view.lineBlockAt(line.from);
    entries.push({ line, lineNum, block, start, end });
  }

  // Find the minimum start column and compute its pixel X once
  let minStartCol = Infinity;
  let minStartLine: Line | null = null;
  for (const entry of entries) {
    if (entry.start < entry.end && entry.start < minStartCol) {
      minStartCol = entry.start;
      minStartLine = entry.line;
    }
  }
  let baseLeftX: number;
  if (minStartLine) {
    const baseCoords = view.coordsAtPos(minStartLine.from + minStartCol, -1);
    baseLeftX = baseCoords ? baseCoords.left - scrollRect.left : minStartCol * charWidth;
  } else {
    baseLeftX = 0;
  }

  // Measure cursor height via coordsAtPos at a known text position — this
  // matches exactly what CodeMirror uses to size the cursor element.
  let cursorTop: number | null = null;
  let cursorBottom: number | null = null;
  if (entries.length > 0) {
    const samplePos = entries[0]!.line.from + entries[0]!.start;
    const coords = view.coordsAtPos(samplePos, 1);
    if (coords) {
      cursorTop = coords.top - scrollRect.top;
      cursorBottom = coords.bottom - scrollRect.top;
    }
  }
  // Height offset from block.top to cursor.top (consistent across lines with same font)
  const cursorVOffset = (cursorTop !== null && entries.length > 0)
    ? cursorTop - entries[0]!.block.top : null;
  const cursorH = (cursorTop !== null && cursorBottom !== null)
    ? cursorBottom - cursorTop : null;

  return entries.map(({ line, lineNum, block, start, end }) => {
    let rightX: number;
    if (start < end) {
      const rightCoords = view.coordsAtPos(line.from + end, 1);
      rightX = rightCoords ? rightCoords.right - scrollRect.left : end * charWidth;
    } else {
      rightX = baseLeftX + minPadCols * charWidth;
    }

    const top = (cursorVOffset !== null) ? block.top + cursorVOffset : block.top;
    const bottom = (cursorH !== null) ? top + cursorH : block.bottom;

    return {
      lineNumber: lineNum,
      left: baseLeftX,
      right: rightX,
      top,
      bottom,
    };
  });
}

function groupLineBounds(lines: LineBounds[]): LineBounds[][] {
  if (lines.length === 0) return [];
  const groups: LineBounds[][] = [];
  let currentGroup: LineBounds[] = [lines[0]!];

  for (let i = 1; i < lines.length; i++) {
    if (lines[i]!.lineNumber === lines[i - 1]!.lineNumber + 1) {
      currentGroup.push(lines[i]!);
    } else {
      groups.push(currentGroup);
      currentGroup = [lines[i]!];
    }
  }
  groups.push(currentGroup);
  return groups;
}

function buildPolygonPath(group: LineBounds[], padding: number = 2, cornerRadius: number = 0, yOffset: number = 0): string {
  if (group.length === 0) return '';
  const P = padding;
  const lines = group.map(lb => ({
    left: lb.left - P,
    right: lb.right + P,
    top: lb.top - P + yOffset,
    bottom: lb.bottom + P + yOffset,
  }));
  const pts: [number, number][] = [];

  pts.push([lines[0]!.right, lines[0]!.top]);
  for (let i = 0; i < lines.length - 1; i++) {
    const curr = lines[i]!;
    const next = lines[i + 1]!;
    if (next.right !== curr.right) {
      const stepY = (curr.bottom + next.top) / 2;
      pts.push([curr.right, stepY]);
      pts.push([next.right, stepY]);
    }
  }
  pts.push([lines[lines.length - 1]!.right, lines[lines.length - 1]!.bottom]);

  pts.push([lines[lines.length - 1]!.left, lines[lines.length - 1]!.bottom]);
  for (let i = lines.length - 1; i > 0; i--) {
    const curr = lines[i]!;
    const prev = lines[i - 1]!;
    if (prev.left !== curr.left) {
      const stepY = (curr.top + prev.bottom) / 2;
      pts.push([curr.left, stepY]);
      pts.push([prev.left, stepY]);
    }
  }
  pts.push([lines[0]!.left, lines[0]!.top]);

  if (cornerRadius <= 0) {
    return 'M' + pts.map(([x, y]) => `${x},${y}`).join('L') + 'Z';
  }

  // Build path with rounded corners using quadratic bezier curves
  const r = cornerRadius;
  const segments: string[] = [];
  const n = pts.length;

  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n]!;
    const curr = pts[i]!;
    const next = pts[(i + 1) % n]!;

    // Vector from curr to prev/next
    const dpx = prev[0] - curr[0], dpy = prev[1] - curr[1];
    const dnx = next[0] - curr[0], dny = next[1] - curr[1];
    const dpLen = Math.sqrt(dpx * dpx + dpy * dpy);
    const dnLen = Math.sqrt(dnx * dnx + dny * dny);

    // Clamp radius to half the shortest adjacent edge
    const maxR = Math.min(dpLen, dnLen) / 2;
    const cr = Math.min(r, maxR);

    // Points where the curve starts/ends (offset from corner by cr)
    const startX = curr[0] + (dpx / dpLen) * cr;
    const startY = curr[1] + (dpy / dpLen) * cr;
    const endX = curr[0] + (dnx / dnLen) * cr;
    const endY = curr[1] + (dny / dnLen) * cr;

    if (i === 0) {
      segments.push(`M${startX},${startY}`);
    } else {
      segments.push(`L${startX},${startY}`);
    }
    segments.push(`Q${curr[0]},${curr[1]} ${endX},${endY}`);
  }
  segments.push('Z');
  return segments.join('');
}

// ─── Overlay-fade hook ───────────────────────────────────────────────────────
//
// In keyboard mode there is no notion of an "insertion mode" — typing writes.
// In gamepad mode (auto-enabled when a gamepad action fires; spec §3.4 input
// gate via `gamepadStateStore.lastInputAt`) the overlay should fade when the
// user enters the dedicated insertion mode (spec §4 mode boundary).
//
// That signal does not yet exist as a global store: the gamepad bridge tracks
// structural-vs-spatial mode internally but doesn't surface "insertion mode".
// Until it does, we wire the infrastructure (a per-measure boolean predicate)
// behind a stub that returns `false`. A future commit can swap in the real
// signal via `setStructuralOverlayFadeProvider(fn)` without touching this
// file.
//
// TODO(structural-editing §3.4 / §4): replace the default no-op provider with
// a subscriber on the gamepad-mode store once "insertion mode" is exposed.

let fadeProvider: () => boolean = () => false;

/**
 * Replace the predicate used to decide whether the structural overlay should
 * render at reduced opacity. Provider returns `true` to fade. Pass `null` to
 * restore the no-op default.
 */
export function setStructuralOverlayFadeProvider(
  provider: (() => boolean) | null,
): void {
  fadeProvider = provider ?? (() => false);
}

const FADE_OPACITY = 0.3;

// ─── Cursor → polygon-target ids ─────────────────────────────────────────────

interface PolygonTarget {
  range: SourceRange;
}

interface CursorTargets {
  /** Polygons to draw. Single entry for node cursors; one per range member for ranges. */
  polygons: PolygonTarget[];
  /** True when this is a single-node cursor (enables parent-edge + cursor-clip). */
  isSingleNode: boolean;
  /** Focused node id for parent-edge and indent-guide walks (null for ranges). */
  focusedId: NodeId | null;
}

function resolveCursorTargets(
  cursor: Cursor,
  idIndex: IdIndex,
  rootChildrenOf: (id: NodeId) => ReadonlyArray<Node> | null,
  docLen: number,
  rootId: NodeId,
): CursorTargets | null {
  void docLen;
  if (cursor.kind === "node") {
    // Skip the document-root cursor — the halo is meaningless for "the whole
    // document" and the legacy plugin treated Program the same way.
    if (cursor.target === rootId) return null;
    const range = idIndex.get(cursor.target);
    if (!range) return null;
    if (range.to <= range.from) return null;
    return {
      polygons: [{ range }],
      isSingleNode: true,
      focusedId: cursor.target,
    };
  }

  // Range cursor: enumerate the parent's children between start and end (incl).
  const siblings = rootChildrenOf(cursor.parent);
  if (!siblings || siblings.length === 0) return null;
  const startIdx = siblings.findIndex((n) => n.id === cursor.start);
  const endIdx = siblings.findIndex((n) => n.id === cursor.end);
  if (startIdx < 0 || endIdx < 0 || startIdx > endIdx) return null;

  const polygons: PolygonTarget[] = [];
  for (let i = startIdx; i <= endIdx; i++) {
    const child = siblings[i]!;
    const range = idIndex.get(child.id);
    if (!range) continue;
    if (range.to <= range.from) continue;
    polygons.push({ range });
  }
  if (polygons.length === 0) return null;
  return { polygons, isSingleNode: false, focusedId: null };
}

// ─── Measurement payload ─────────────────────────────────────────────────────

interface NodeOverlayMeasure {
  polygons: PolygonData[];
  parentLines: LineData[];
  indentGuides: LineData[];
  indentStyle: IndentGuideStyle;
  cursorAtEdge: boolean;
  cursorInside: boolean;
  fade: boolean;
}

const DEFAULT_INDENT_STYLE: IndentGuideStyle = {
  width: 1,
  opacity: 0.15,
  luminosity: 0.5,
  dash: 4,
  gap: 4,
  yPadding: 2,
};

// ─── ViewPlugin ──────────────────────────────────────────────────────────────

class StructuralNodeOverlayPlugin {
  private svgOverlay: SVGSVGElement;
  private view: EditorView;
  private unsubSettings: (() => void) | null = null;
  private pendingRAF: number | null = null;

  constructor(view: EditorView) {
    this.view = view;
    this.svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    // Size is set explicitly each render to match scrollDOM's full scrollable
    // content area (not just the visible viewport): polygons are positioned in
    // doc-space, so the SVG must cover doc-space [0, scrollHeight] or anything
    // below the first viewport gets clipped even after the user scrolls to it.
    this.svgOverlay.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      pointer-events: none;
      z-index: 0;
      overflow: visible;
    `;
    view.scrollDOM.appendChild(this.svgOverlay);
    this.unsubSettings = subscribeAppSettings(() => this.debouncedMeasure());
    dlog("mounted; scrollDOM size", view.scrollDOM.scrollWidth, "x", view.scrollDOM.scrollHeight);
    this.scheduleMeasure();
  }

  update(u: ViewUpdate): void {
    this.view = u.view;
    const oldField = u.startState.field(structField, false);
    const newField = u.state.field(structField, false);
    // selectionSet is required so the cursor-clip read picks up the new caret
    // position even when the structural cursor itself didn't change.
    if (
      u.docChanged ||
      u.viewportChanged ||
      u.geometryChanged ||
      u.selectionSet ||
      oldField !== newField
    ) {
      this.debouncedMeasure();
    }
  }

  /** Debounce to one measure per animation frame — prevents the expensive
   *  coordsAtPos/getBoundingClientRect cascade from running on every keystroke. */
  private debouncedMeasure(): void {
    if (this.pendingRAF !== null) return;
    this.pendingRAF = requestAnimationFrame(() => {
      this.pendingRAF = null;
      this.scheduleMeasure();
    });
  }

  destroy(): void {
    if (this.pendingRAF !== null) cancelAnimationFrame(this.pendingRAF);
    // Clear any cursor clip we installed on the cursor layer before tearing
    // down the SVG that defined it.
    const cursorLayer = this.view.dom.querySelector('.cm-cursorLayer') as HTMLElement | null;
    if (cursorLayer) cursorLayer.style.clipPath = '';
    this.view.dom.classList.remove('useq-hide-bracket-match');
    this.svgOverlay.remove();
    this.unsubSettings?.();
    this.unsubSettings = null;
  }

  private scheduleMeasure(): void {
    const self = this;
    this.view.requestMeasure({
      read(view: EditorView): NodeOverlayMeasure {
        const empty: NodeOverlayMeasure = {
          polygons: [],
          parentLines: [],
          indentGuides: [],
          indentStyle: DEFAULT_INDENT_STYLE,
          cursorAtEdge: false,
          cursorInside: false,
          fade: false,
        };

        const value = view.state.field(structField, false);
        if (!value) return empty;

        const cursor = value.state.cursors.primary;
        const root = value.state.tree.root;
        const idIndex = value.idIndex;
        const docLen = view.state.doc.length;

        const rootChildrenOf = (id: NodeId): ReadonlyArray<Node> | null => {
          if (root.id === id) return root.children;
          // Walk to find a compound by id; range cursors only point at compounds.
          let found: ReadonlyArray<Node> | null = null;
          const visit = (n: Node): boolean => {
            if (n.id === id) {
              if (n.kind === "document" || isCompound(n)) {
                found = n.children;
              }
              return true;
            }
            if (n.kind === "document" || isCompound(n)) {
              for (const c of n.children) {
                if (visit(c)) return true;
              }
            }
            return false;
          };
          visit(root);
          return found;
        };

        const targets = resolveCursorTargets(cursor, idIndex, rootChildrenOf, docLen, root.id);
        dlog("measure: cursor", cursor, "targets?", !!targets, targets ? { polyCount: targets.polygons.length, isSingleNode: targets.isSingleNode, focusedId: targets.focusedId } : null);

        const uiSettings = getAppSettings()?.ui;
        const cornerRadius = uiSettings?.nodeHighlightCornerRadius ?? 3;
        const yOffset = uiSettings?.nodeHighlightYOffset ?? 0;

        // ── Polygons ─────────────────────────────────────────────────────────
        const polygons: PolygonData[] = [];
        if (targets) {
          for (const t of targets.polygons) {
            const from = Math.max(0, Math.min(t.range.from, docLen));
            const to = Math.max(0, Math.min(t.range.to, docLen));
            if (to <= from) continue;
            const lineBounds = computeNodeLineBounds(view, from, to);
            if (lineBounds.length === 0) continue;
            const blocks = groupLineBounds(lineBounds);
            for (const block of blocks) {
              const pathD = buildPolygonPath(block, 3, cornerRadius, yOffset);
              if (pathD) polygons.push({ pathD, isCurrent: true });
            }
          }
        }

        // ── Indent guides ────────────────────────────────────────────────────
        // Modes: "always" (every multi-line container in the doc), "path"
        // (focused node's ancestor chain only), "never" (skip).
        const indentMode = uiSettings?.indentGuideMode ?? "always";
        const indentYPad = uiSettings?.indentGuideYPadding ?? 2;
        const indentGuides: LineData[] = [];
        dlog("indent walk: mode=", indentMode, "focusedId?", targets?.focusedId);
        if (indentMode !== "never") {
          const inset = view.defaultCharacterWidth * 0.6;
          const containers: Node[] =
            indentMode === "always"
              ? collectAllContainers(root)
              : targets?.focusedId != null
                ? collectAncestorChain(root, targets.focusedId)
                : [];

          for (const node of containers) {
            const range = idIndex.get(node.id);
            if (!range) continue;
            const bounds = computeNodeLineBounds(view, range.from, range.to);
            if (bounds.length <= 1) continue;
            const first = bounds[0]!;
            const last = bounds[bounds.length - 1]!;
            const x = first.left + inset;
            indentGuides.push({
              x1: x,
              y1: first.bottom + indentYPad,
              x2: x,
              y2: last.bottom - indentYPad,
            });
          }
          dlog("indent walk: containers=", containers.length, "guides=", indentGuides.length);
        }

        const indentStyle: IndentGuideStyle = {
          width: uiSettings?.indentGuideWidth ?? DEFAULT_INDENT_STYLE.width,
          opacity: uiSettings?.indentGuideOpacity ?? DEFAULT_INDENT_STYLE.opacity,
          luminosity: uiSettings?.indentGuideLuminosity ?? DEFAULT_INDENT_STYLE.luminosity,
          dash: uiSettings?.indentGuideDash ?? DEFAULT_INDENT_STYLE.dash,
          gap: uiSettings?.indentGuideGap ?? DEFAULT_INDENT_STYLE.gap,
          yPadding: indentYPad,
        };

        // ── Parent edge (single-node cursors only) ───────────────────────────
        const parentLines: LineData[] = [];
        if (targets && targets.isSingleNode && targets.focusedId !== null) {
          const parent = parentOf(root, targets.focusedId);
          dlog("parent edge: parent kind=", parent?.kind, "id=", parent?.id);
          if (parent && parent.kind !== "document" && isCompound(parent)) {
            const parentRange = idIndex.get(parent.id);
            if (parentRange) {
              const parentBounds = computeNodeLineBounds(
                view,
                parentRange.from,
                parentRange.to,
              );
              dlog("parent edge: parentRange", parentRange, "bounds.len", parentBounds.length);
              if (parentBounds.length > 0) {
                const lastLine = parentBounds[parentBounds.length - 1]!;
                parentLines.push({
                  x1: lastLine.left - 3,
                  y1: lastLine.bottom + 2,
                  x2: lastLine.right + 3,
                  y2: lastLine.bottom + 2,
                });
              }
            }
          }
        }

        // ── Cursor clip (single-node cursors only) ───────────────────────────
        let cursorAtEdge = false;
        let cursorInside = false;
        if (targets && targets.isSingleNode && targets.polygons.length === 1) {
          const focusRange = targets.polygons[0]!.range;
          const cursorPos = view.state.selection.main.head;
          cursorAtEdge = cursorPos === focusRange.to;
          cursorInside =
            cursorPos >= focusRange.from && cursorPos < focusRange.to;
        }

        return {
          polygons,
          parentLines,
          indentGuides,
          indentStyle,
          cursorAtEdge,
          cursorInside,
          fade: fadeProvider(),
        };
      },
      write(measure: NodeOverlayMeasure) {
        dlog("write: polygons=", measure.polygons.length, "indentGuides=", measure.indentGuides.length, "parentLines=", measure.parentLines.length, "fade=", measure.fade);
        self.renderOverlay(measure);
      },
    });
  }

  private renderOverlay(measure: NodeOverlayMeasure): void {
    while (this.svgOverlay.firstChild) {
      this.svgOverlay.removeChild(this.svgOverlay.firstChild);
    }

    // Cover the full scrollable content, not just the visible viewport —
    // polygon coords are in doc-space (see computeNodeLineBounds), so the SVG
    // must extend to scrollHeight or anything below the initial viewport is
    // clipped by the SVG's own bounds and never reappears on scroll.
    const scrollWidth = this.view.scrollDOM.scrollWidth;
    const scrollHeight = this.view.scrollDOM.scrollHeight;
    this.svgOverlay.style.width = `${scrollWidth}px`;
    this.svgOverlay.style.height = `${scrollHeight}px`;
    this.svgOverlay.setAttribute('viewBox', `0 0 ${scrollWidth} ${scrollHeight}`);

    // Apply fade opacity to the overlay as a whole (legacy renders all halo
    // elements together; one opacity dim covers indent guides + polygons +
    // parent edge consistently).
    this.svgOverlay.style.opacity = measure.fade ? String(FADE_OPACITY) : '1';

    // 1. Indent guides — drawn FIRST so polygons render on top.
    const { indentStyle, indentGuides } = measure;
    if (indentGuides.length > 0) {
      const r = Math.round(255 * indentStyle.luminosity);
      const g = Math.round(80 * indentStyle.luminosity);
      const b = Math.round(130 * indentStyle.luminosity);
      const strokeColor = `rgba(${r}, ${g}, ${b}, ${indentStyle.opacity})`;
      const dashArray = `${indentStyle.dash} ${indentStyle.gap}`;
      for (const guide of indentGuides) {
        const lineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        lineEl.setAttribute('x1', String(guide.x1));
        lineEl.setAttribute('y1', String(guide.y1));
        lineEl.setAttribute('x2', String(guide.x2));
        lineEl.setAttribute('y2', String(guide.y2));
        lineEl.setAttribute('stroke', strokeColor);
        lineEl.setAttribute('stroke-width', String(indentStyle.width));
        lineEl.setAttribute('stroke-dasharray', dashArray);
        this.svgOverlay.appendChild(lineEl);
      }
    }

    // 2. Node polygons.
    for (const poly of measure.polygons) {
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', poly.pathD);
      path.setAttribute('fill', 'rgba(255, 100, 150, 0.15)');
      path.setAttribute('stroke', 'rgba(255, 80, 130, 0.7)');
      path.setAttribute('stroke-width', '2');
      this.svgOverlay.appendChild(path);
    }

    // 3. Parent edge.
    for (const line of measure.parentLines) {
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

    // 4. Cursor clip on .cm-cursorLayer.
    const cursorLayer = this.view.dom.querySelector('.cm-cursorLayer') as HTMLElement | null;
    if (cursorLayer) {
      const wantClip =
        measure.polygons.length > 0 &&
        (measure.cursorInside || measure.cursorAtEdge);
      if (wantClip) {
        const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
        const clipPath = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
        clipPath.setAttribute('id', 'useq-node-cursor-clip');
        clipPath.setAttribute('clipPathUnits', 'userSpaceOnUse');

        if (measure.cursorAtEdge) {
          // Inverted clip via even-odd: the cursor only paints outside the
          // polygon (lets the caret peek past the trailing edge).
          const outerRect = `M-10,-10 H${scrollWidth + 10} V${scrollHeight + 10} H-10 Z`;
          for (const poly of measure.polygons) {
            const clipEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            clipEl.setAttribute('d', outerRect + ' ' + poly.pathD);
            clipEl.setAttribute('clip-rule', 'evenodd');
            clipPath.appendChild(clipEl);
          }
        } else {
          // Normal clip: the cursor only paints inside the polygon.
          for (const poly of measure.polygons) {
            const clipEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            clipEl.setAttribute('d', poly.pathD);
            clipPath.appendChild(clipEl);
          }
        }

        defs.appendChild(clipPath);
        this.svgOverlay.appendChild(defs);
        cursorLayer.style.clipPath = 'url(#useq-node-cursor-clip)';
      } else {
        cursorLayer.style.clipPath = '';
      }
    }

    // 5. Bracket-match suppression — bracket decorations are inline spans and
    // can't be SVG-clipped, so we hide them via a class while the node
    // highlight is showing structure.
    this.view.dom.classList.toggle('useq-hide-bracket-match', measure.polygons.length > 0);

    dlog("rendered: svg children=", this.svgOverlay.childNodes.length, "viewBox=", this.svgOverlay.getAttribute('viewBox'));
  }
}

// Tiny by-id walk used in the read pass. Avoids importing `findById` which
// also handles the document-root case differently than we want here.
function findNodeById(root: Node, id: NodeId): Node | null {
  if (root.id === id) return root;
  if (root.kind === "document" || isCompound(root)) {
    for (const c of root.children) {
      const found = findNodeById(c, id);
      if (found) return found;
    }
  }
  return null;
}

/** Every compound in the tree (document root excluded). For "always" mode. */
function collectAllContainers(root: Node): Node[] {
  const out: Node[] = [];
  const visit = (n: Node): void => {
    if (isCompound(n)) out.push(n);
    if (n.kind === "document" || isCompound(n)) {
      for (const c of n.children) visit(c);
    }
  };
  visit(root);
  return out;
}

/** Focused node (if it is a container) plus its compound ancestors. For "path" mode. */
function collectAncestorChain(root: Node, focusedId: NodeId): Node[] {
  const out: Node[] = [];
  const focused = findNodeById(root, focusedId);
  let cursor: Node | null =
    focused && (focused.kind === "document" || isCompound(focused))
      ? focused
      : (parentOf(root as DocumentNodeShape, focusedId) as Node | null);
  while (cursor && cursor.kind !== "document") {
    out.push(cursor);
    const next = parentOf(root as DocumentNodeShape, cursor.id);
    if (!next || next.kind === "document") break;
    cursor = next;
  }
  return out;
}

// Local type alias to satisfy parentOf's narrower DocumentNode parameter
// without re-importing the type — the run-time root we're handed always is one.
type DocumentNodeShape = Parameters<typeof parentOf>[0];

// `indexOfChild` is re-exported from core/index.ts for downstream callers and
// future stages. We don't currently need it here (we walk siblings directly
// via findIndex), but the export was added per the stage 2 spec to give
// adapters a stable API for range enumeration.
void indexOfChild;

export const structuralNodeOverlay = ViewPlugin.fromClass(StructuralNodeOverlayPlugin);

/**
 * Test-only exports. Geometry-independent helpers that the jsdom-tolerant
 * tests can exercise without relying on `view.coordsAtPos()` returning
 * meaningful values.
 */
export const _internalsForTests = {
  resolveCursorTargets,
  findNodeById,
};

/**
 * Theme placeholder for the SVG overlay. The polygon styling is set directly
 * on the SVG path elements (verbatim from legacy), so this base theme is
 * currently empty — it exists so the bundle can stay symmetrical with the
 * hole-pill `holePillTheme` and so future stages have a hook for tunable CSS.
 */
export const structuralNodeOverlayTheme = EditorView.baseTheme({});
