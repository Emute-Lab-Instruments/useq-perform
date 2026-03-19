/**
 * visReadability — backdrop-blur readability layer for the CodeMirror editor.
 *
 * When the serialVis canvas overlays the editor, text can be hard to read
 * against the animated background.  This ViewPlugin places a backdrop-blur
 * layer *between* the vis canvas and the editor text by restructuring
 * z-indexes at runtime:
 *
 *   #panel-main-editor  z-index: 21  (raised above vis, transparent bg)
 *   blur overlay         z-index: 20  (backdrop-filter blurs vis below)
 *   #panel-vis           z-index: 19  (vis canvas, unchanged)
 *
 * The blur regions are clipped to staircase-shaped polygons that hug only
 * the non-whitespace content on each visible line, so the vis is still
 * fully visible in the gaps between code.
 */

import { ViewPlugin, EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  getVisualisationPanel,
  isVisualisationPanelVisible,
} from "../../ui/adapters/visualisationPanel";

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
 * content.  Returns coordinates in **viewport space** (relative to the
 * browser window), suitable for a fixed-position overlay element.
 */
function computeVisibleLineBoundsViewport(view: EditorView): PixelLineBounds[] {
  const { from, to } = view.viewport;

  const result: PixelLineBounds[] = [];

  let pos = from;
  while (pos <= to) {
    const line = view.state.doc.lineAt(pos);
    const text = line.text;
    const { start: charStart, end: charEnd } = getLineContentBounds(text);

    if (charStart < charEnd) {
      const startPos = line.from + charStart;
      const endPos   = line.from + charEnd;

      const startCoords = view.coordsAtPos(startPos);
      const endCoords = view.coordsAtPos(endPos, -1);

      if (startCoords && endCoords) {
        result.push({
          lineIndex: line.number,
          left:   startCoords.left,
          right:  endCoords.right,
          top:    startCoords.top,
          bottom: startCoords.bottom,
        });
      }
    }

    if (line.to >= to) break;
    pos = line.to + 1;
  }

  return result;
}

// ---------------------------------------------------------------------------
// Backdrop-blur rendering helpers
// ---------------------------------------------------------------------------

const BLUR_RADIUS = 6;
const PADDING = 3;
const EDITOR_RAISED_Z = '21';
const BLUR_LAYER_Z = '20';

function isVisPanelVisible(): boolean {
  return isVisualisationPanelVisible();
}

function writeBackdrop(overlay: HTMLDivElement, lineBounds: PixelLineBounds[]): void {
  while (overlay.firstChild) overlay.removeChild(overlay.firstChild);
  if (lineBounds.length === 0) return;

  const blocks = groupIntoBlocks(lineBounds);

  for (const block of blocks) {
    const pathStr = buildBlockPolygonPath(block, PADDING);
    if (!pathStr) continue;

    const div = document.createElement('div');
    div.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100vw',
      'height:100vh',
      'pointer-events:none',
      `backdrop-filter:blur(${BLUR_RADIUS}px)`,
      `-webkit-backdrop-filter:blur(${BLUR_RADIUS}px)`,
      `clip-path:path("${pathStr}")`,
    ].join(';');
    overlay.appendChild(div);
  }
}

interface MeasureResult {
  lineBounds: PixelLineBounds[];
  visVisible: boolean;
}

function scheduleOverlayRebuild(
  overlay: HTMLDivElement,
  view: EditorView,
  onVisChange: (visible: boolean) => void,
): void {
  view.requestMeasure({
    read(v: EditorView): MeasureResult {
      const visVisible = isVisPanelVisible();
      if (!visVisible) return { lineBounds: [], visVisible };
      return { lineBounds: computeVisibleLineBoundsViewport(v), visVisible };
    },
    write({ lineBounds, visVisible }: MeasureResult) {
      onVisChange(visVisible);
      writeBackdrop(overlay, lineBounds);
    },
  });
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

class VisReadabilityPlugin {
  private overlay: HTMLDivElement;
  private view: EditorView;
  private mutationObserver: MutationObserver;
  private editorPanel: HTMLElement | null = null;
  private wasVisVisible = false;

  constructor(view: EditorView) {
    this.view = view;

    // Create a fixed-position overlay as a page-level sibling, between
    // #panel-vis (z:19) and #panel-main-editor (raised to z:21).
    this.overlay = document.createElement('div');
    this.overlay.style.cssText = [
      'position:fixed',
      'top:0',
      'left:0',
      'width:100vw',
      'height:100vh',
      'pointer-events:none',
      `z-index:${BLUR_LAYER_Z}`,
    ].join(';');
    document.body.appendChild(this.overlay);

    this.editorPanel = document.getElementById('panel-main-editor');

    // Watch for vis panel style changes (display toggled) to refresh.
    this.mutationObserver = new MutationObserver(() =>
      scheduleOverlayRebuild(this.overlay, this.view, (v) => this.applyVisState(v)),
    );
    const visPanel = getVisualisationPanel();
    if (visPanel) {
      this.mutationObserver.observe(visPanel, { attributes: true, attributeFilter: ['style'] });
    }

    scheduleOverlayRebuild(this.overlay, view, (v) => this.applyVisState(v));
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      scheduleOverlayRebuild(this.overlay, update.view, (v) => this.applyVisState(v));
    }
  }

  destroy(): void {
    this.mutationObserver.disconnect();
    this.overlay.remove();
    // Restore editor z-index
    if (this.editorPanel) {
      this.editorPanel.style.zIndex = '';
    }
    // Restore CM editor background
    this.view.dom.style.backgroundColor = '';
  }

  /**
   * When vis is visible: raise the editor panel above the vis and make
   * the CM editor background transparent so the vis shows through.
   * When vis is hidden: restore defaults.
   */
  private applyVisState(visVisible: boolean): void {
    if (visVisible === this.wasVisVisible) return;
    this.wasVisVisible = visVisible;

    if (visVisible) {
      if (this.editorPanel) {
        this.editorPanel.style.zIndex = EDITOR_RAISED_Z;
      }
      this.view.dom.style.backgroundColor = 'transparent';
    } else {
      if (this.editorPanel) {
        this.editorPanel.style.zIndex = '';
      }
      this.view.dom.style.backgroundColor = '';
    }
  }
}

/**
 * CodeMirror extension that renders a backdrop-blur layer between the editor
 * text and the vis canvas, blurring the vis colours behind code regions.
 *
 * Restructures z-indexes when vis is active:
 *   editor (z:21) → blur overlay (z:20) → vis (z:19)
 */
export const visReadabilityPlugin = ViewPlugin.fromClass(VisReadabilityPlugin);
