/**
 * visReadability — SVG polygon readability layer for the CodeMirror editor.
 *
 * When the serialVis canvas overlays the editor, text can be hard to read
 * against the animated background. This ViewPlugin renders a semi-transparent
 * SVG polygon "backdrop" that hugs only the non-whitespace content on each
 * visible line, grouping adjacent lines into unified staircase-shaped polygons.
 *
 * Layering:
 *   Editor text (natural CM stacking, above SVG in DOM order)
 *   SVG polygon layer  ← this file
 *   serialVis canvas (#panel-vis, z-index: 19)
 *   #panel-main-editor (z-index: 0, transparent background when vis active)
 */

import { ViewPlugin, EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  getVisualisationPanel,
  isVisualisationPanelVisible,
} from "../../../ui/adapters/visualisationPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Pixel-space bounds for one line's non-whitespace content. */
export interface PixelLineBounds {
  /** 1-based line number — used to detect adjacency in groupIntoBlocks. */
  lineIndex: number;
  /** Pixel X of the first non-whitespace character (document coordinates). */
  left: number;
  /** Pixel X just past the last non-whitespace character (document coordinates). */
  right: number;
  /** Pixel Y of the line's top edge (document coordinates, i.e. distance from doc start). */
  top: number;
  /** Pixel Y of the line's bottom edge (document coordinates). */
  bottom: number;
}

// ---------------------------------------------------------------------------
// Pure functions (testable without DOM)
// ---------------------------------------------------------------------------

/**
 * Returns the character-index range [start, end) of non-whitespace content
 * in `text`, stripping leading and trailing ASCII spaces (U+0020) only.
 *
 * When the line is blank or space-only, start === end.
 */
export function getLineContentBounds(text: string): { start: number; end: number } {
  let start = 0;
  while (start < text.length && text[start] === ' ') start++;

  let end = text.length;
  while (end > start && text[end - 1] === ' ') end--;

  return { start, end };
}

/**
 * Groups an array of `PixelLineBounds` (sorted by lineIndex) into runs of
 * consecutive lines (lineIndex differing by exactly 1).  Each run becomes
 * one block that will be rendered as a single staircase polygon.
 */
export function groupIntoBlocks(lines: PixelLineBounds[]): PixelLineBounds[][] {
  if (lines.length === 0) return [];

  const groups: PixelLineBounds[][] = [];
  let currentGroup: PixelLineBounds[] = [lines[0]];

  for (let i = 1; i < lines.length; i++) {
    if (lines[i].lineIndex === lines[i - 1].lineIndex + 1) {
      currentGroup.push(lines[i]);
    } else {
      groups.push(currentGroup);
      currentGroup = [lines[i]];
    }
  }
  groups.push(currentGroup);

  return groups;
}

/**
 * Builds a closed SVG path string for a staircase-shaped polygon that
 * surrounds the content bounds of all lines in `group`.
 *
 * The polygon steps in/out on both the left and right sides as line widths
 * vary, creating a tight "staircase" silhouette.
 *
 * @param group   Array of PixelLineBounds for one block of adjacent lines.
 * @param padding Pixels of outward padding added to left/right/top/bottom.
 */
export function buildBlockPolygonPath(group: PixelLineBounds[], padding: number = 2): string {
  if (group.length === 0) return '';

  const P = padding;

  // Apply padding to each line's bounds.
  const lines = group.map(lb => ({
    left:   lb.left   - P,
    right:  lb.right  + P,
    top:    lb.top    - P,
    bottom: lb.bottom + P,
  }));

  const pts: [number, number][] = [];

  // ── Right side: trace from top-right of first line down to bottom-right of last ──

  pts.push([lines[0].right, lines[0].top]);

  for (let i = 0; i < lines.length - 1; i++) {
    const curr = lines[i];
    const next = lines[i + 1];
    if (next.right !== curr.right) {
      // Emit the corner at the bottom of the current line, then step horizontally.
      // Use the midpoint Y so we don't rely on curr.bottom === next.top (padding can shift these).
      const stepY = (curr.bottom + next.top) / 2;
      pts.push([curr.right, stepY]);
      pts.push([next.right, stepY]);
    }
    // If same right edge, we continue down smoothly — no extra points needed.
  }

  pts.push([lines[lines.length - 1].right, lines[lines.length - 1].bottom]);

  // ── Left side: trace from bottom-left of last line up to top-left of first ──

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

// ---------------------------------------------------------------------------
// DOM helpers (called from the ViewPlugin)
// ---------------------------------------------------------------------------

/**
 * Computes PixelLineBounds for every visible line that contains non-whitespace
 * content.  Returns coordinates in the CM "document coordinate" space (Y=0 at
 * top of document, independent of scroll position), which matches the SVG
 * overlay positioned at top:0 / left:0 inside the scroll container.
 */
function computeVisibleLineBounds(view: EditorView): PixelLineBounds[] {
  const { from, to } = view.viewport;
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const scrollLeft = view.scrollDOM.scrollLeft;
  const charWidth = view.defaultCharacterWidth;

  const result: PixelLineBounds[] = [];

  // Walk through visible line positions.
  let pos = from;
  while (pos <= to) {
    const line = view.state.doc.lineAt(pos);
    const block = view.lineBlockAt(pos);
    const text = line.text;
    const { start: charStart, end: charEnd } = getLineContentBounds(text);

    if (charStart < charEnd) {
      // Get viewport-X of the first non-whitespace character via coordsAtPos.
      const startPos = line.from + charStart;
      const endPos   = line.from + charEnd - 1; // last char position

      const startCoords = view.coordsAtPos(startPos);
      // Use bias=1 (right side) for the end position to get the right edge of the last char.
      const endCoords = view.coordsAtPos(endPos, 1);

      if (startCoords && endCoords) {
        // Convert from viewport-X to document-X (same reference frame as block.top).
        const left  = startCoords.left - scrollRect.left + scrollLeft;
        const right = endCoords.right  - scrollRect.left + scrollLeft;

        result.push({
          lineIndex: line.number,
          left,
          right,
          top:    block.top,
          bottom: block.bottom,
        });
      }
    }

    if (line.to >= to) break;
    pos = line.to + 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// SVG rendering helpers
// ---------------------------------------------------------------------------

const FILL_COLOR = 'rgba(0, 0, 0, 0.62)';
const PADDING = 3;

function isVisPanelVisible(): boolean {
  return isVisualisationPanelVisible();
}

function rebuildSVG(svg: SVGSVGElement, view: EditorView): void {
  // Clear existing content.
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  // Only render polygons when the serialVis overlay is active.
  if (!isVisPanelVisible()) return;

  const lineBounds = computeVisibleLineBounds(view);
  if (lineBounds.length === 0) return;

  const blocks = groupIntoBlocks(lineBounds);

  for (const block of blocks) {
    const pathStr = buildBlockPolygonPath(block, PADDING);
    if (!pathStr) continue;

    const pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    pathEl.setAttribute('d', pathStr);
    pathEl.setAttribute('fill', FILL_COLOR);
    svg.appendChild(pathEl);
  }
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

class VisReadabilityPlugin {
  private svg: SVGSVGElement;
  private view: EditorView;
  private mutationObserver: MutationObserver;

  constructor(view: EditorView) {
    this.view = view;
    this.svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    // Position absolutely at the top of the scroll container so document
    // coordinates from lineBlockAt / coordsAtPos map 1:1 to SVG coordinates.
    this.svg.style.cssText = [
      'position:absolute',
      'top:0',
      'left:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'overflow:visible',
      'z-index:0',
    ].join(';');

    // Insert before contentDOM so the SVG is painted behind the text.
    view.scrollDOM.insertBefore(this.svg, view.contentDOM);

    // Watch for vis panel style changes (display toggled) to refresh polygons.
    this.mutationObserver = new MutationObserver(() => rebuildSVG(this.svg, this.view));
    const visPanel = getVisualisationPanel();
    if (visPanel) {
      this.mutationObserver.observe(visPanel, { attributes: true, attributeFilter: ['style'] });
    }

    rebuildSVG(this.svg, view);
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      rebuildSVG(this.svg, update.view);
    }
  }

  destroy(): void {
    this.mutationObserver.disconnect();
    this.svg.remove();
  }
}

/**
 * CodeMirror extension that renders a semi-transparent SVG polygon background
 * behind the editor text, tightly hugging non-whitespace content per line.
 *
 * Add this to your editor's extension list when the serialVis overlay is active
 * so that code remains readable over the animated background.
 */
export const visReadabilityPlugin = ViewPlugin.fromClass(VisReadabilityPlugin);
