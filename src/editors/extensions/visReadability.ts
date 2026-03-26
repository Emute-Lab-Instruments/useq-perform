/**
 * visReadability — pre-blurred canvas readability layer for the CodeMirror editor.
 *
 * When the serialVis canvas overlays the editor, text can be hard to read
 * against the animated background.  This ViewPlugin maintains a pre-blurred
 * copy of the vis canvas and masks it to staircase polygons behind the text:
 *
 *   CM text content                (z-index: auto, within editor stacking context)
 *   overlay canvas (inside editor) (z-index: -1,   shows pre-blurred vis through polygon mask)
 *   #panel-main-editor             (z-index: 21,   raised above vis, transparent bg)
 *   #panel-vis                     (z-index: 19,   vis canvas, unchanged)
 *
 * The blur is computed once per vis frame into an offscreen buffer, then the
 * overlay canvas clips that buffer to staircase polygons that hug the code.
 * Scrolling only shifts the clip mask — no re-blur is needed, so scroll
 * performance is decoupled from blur cost.
 */

import { ViewPlugin, EditorView } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import {
  getVisualisationPanel,
  isVisualisationPanelVisible,
} from "../../ui/adapters/visualisationPanel";
import { getAppSettings } from "../../runtime/appSettingsRepository";

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
 * Number of lines to precompute beyond each edge of the viewport.
 * These lines get estimated bounds so the blur is already in place
 * when the user scrolls them into view.
 */
const OVERSCAN_LINES = 30;

/**
 * Computes PixelLineBounds for visible lines plus an overscan buffer.
 *
 * Lines inside the CM viewport get precise coords via `coordsAtPos`.
 * Lines in the overscan zone (beyond the viewport) get estimated coords
 * using `lineBlockAt` (document-space) converted to viewport-space.
 */
function computeVisibleLineBoundsViewport(view: EditorView): PixelLineBounds[] {
  const { from: vpFrom, to: vpTo } = view.viewport;
  const doc = view.state.doc;
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const scrollTop = view.scrollDOM.scrollTop;
  const charWidth = view.defaultCharacterWidth;

  // Determine line range: viewport lines plus overscan.
  const vpFirstLine = doc.lineAt(vpFrom).number;
  const vpLastLine  = doc.lineAt(vpTo).number;
  const firstLine = Math.max(1, vpFirstLine - OVERSCAN_LINES);
  const lastLine  = Math.min(doc.lines, vpLastLine + OVERSCAN_LINES);

  const result: PixelLineBounds[] = [];

  for (let lineNum = firstLine; lineNum <= lastLine; lineNum++) {
    const line = doc.line(lineNum);
    const text = line.text;
    const { start: charStart, end: charEnd } = getLineContentBounds(text);
    if (charStart >= charEnd) continue;

    const inViewport = line.from >= vpFrom && line.from <= vpTo;

    if (inViewport) {
      // Precise measurement via coordsAtPos.
      const startCoords = view.coordsAtPos(line.from + charStart);
      const endCoords   = view.coordsAtPos(line.from + charEnd, -1);
      if (startCoords && endCoords) {
        result.push({
          lineIndex: lineNum,
          left:   startCoords.left,
          right:  endCoords.right,
          top:    startCoords.top,
          bottom: startCoords.bottom,
        });
      }
    } else {
      // Estimated measurement via lineBlockAt (document coords → viewport).
      const block = view.lineBlockAt(line.from);
      const top    = block.top - scrollTop + scrollRect.top;
      const bottom = block.bottom - scrollTop + scrollRect.top;
      const left   = scrollRect.left + charStart * charWidth;
      const right  = scrollRect.left + charEnd * charWidth;
      result.push({ lineIndex: lineNum, left, right, top, bottom });
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Pre-blurred canvas rendering
// ---------------------------------------------------------------------------

const DEFAULT_BLUR_RADIUS = 10;
const DEFAULT_PADDING = 3;
const EDITOR_RAISED_Z = '21';
const VIS_CANVAS_ID = 'serialcanvas';

function isVisPanelVisible(): boolean {
  return isVisualisationPanelVisible();
}

/** Build a combined Path2D from line bounds (all blocks in one path). */
function buildClipPath(lineBounds: PixelLineBounds[], padding: number): Path2D | null {
  const blocks = groupIntoBlocks(lineBounds);
  if (blocks.length === 0) return null;

  const combined = new Path2D();
  for (const block of blocks) {
    const pathStr = buildBlockPolygonPath(block, padding);
    if (pathStr) combined.addPath(new Path2D(pathStr));
  }
  return combined;
}

interface MeasureResult {
  lineBounds: PixelLineBounds[];
  visVisible: boolean;
  /** The scrollDOM.scrollTop at the time of measurement. */
  scrollTop: number;
  /** Editor panel's top offset from viewport (for aligning blur buffer). */
  editorTop: number;
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

class VisReadabilityPlugin {
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null;
  private blurBuffer: HTMLCanvasElement;
  private blurCtx: CanvasRenderingContext2D | null;
  private view: EditorView;
  private mutationObserver: MutationObserver;
  private editorPanel: HTMLElement | null = null;
  private wasVisVisible = false;
  /** scrollTop at the time polygons were last computed. */
  private scrollBaseline = 0;
  /** Current scroll delta from baseline (updated every scroll event). */
  private scrollDelta = 0;
  /** Bound scroll handler for cleanup. */
  private handleScroll: () => void;
  /** Timer for debounced polygon rebuild on scroll. */
  private scrollRebuildTimer: ReturnType<typeof setTimeout> | null = null;
  /** Cached clip path built from staircase polygons. */
  private clipPath: Path2D | null = null;
  /** rAF handle for the render loop. */
  private rafId: number | null = null;
  /** Editor panel top offset from viewport (cached during measure). */
  private editorTop = 0;

  constructor(view: EditorView) {
    this.view = view;

    // Visible overlay canvas inside the editor panel, behind CM text.
    this.overlayCanvas = document.createElement('canvas');
    this.overlayCanvas.style.cssText = [
      'position:absolute',
      'inset:0',
      'width:100%',
      'height:100%',
      'pointer-events:none',
      'z-index:-1',
    ].join(';');
    this.overlayCtx = this.overlayCanvas.getContext('2d');

    // Offscreen buffer for the blurred vis copy.
    this.blurBuffer = document.createElement('canvas');
    this.blurCtx = this.blurBuffer.getContext('2d');

    this.editorPanel = document.getElementById('panel-main-editor');
    (this.editorPanel ?? document.body).appendChild(this.overlayCanvas);

    // Track scroll: update delta for the render loop, and debounce a
    // full polygon rebuild for newly-scrolled-in lines.
    this.handleScroll = () => {
      this.scrollDelta = this.view.scrollDOM.scrollTop - this.scrollBaseline;
      this.debouncedRebuild();
    };
    view.scrollDOM.addEventListener('scroll', this.handleScroll, { passive: true });

    // Watch for vis panel style changes (display toggled) to refresh.
    this.mutationObserver = new MutationObserver(() =>
      this.scheduleRebuild(),
    );
    const visPanel = getVisualisationPanel();
    if (visPanel) {
      this.mutationObserver.observe(visPanel, { attributes: true, attributeFilter: ['style'] });
    }

    this.scheduleRebuild();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.scheduleRebuild();
    }
  }

  destroy(): void {
    this.stopRenderLoop();
    if (this.scrollRebuildTimer !== null) clearTimeout(this.scrollRebuildTimer);
    this.view.scrollDOM.removeEventListener('scroll', this.handleScroll);
    this.mutationObserver.disconnect();
    this.overlayCanvas.remove();
    if (this.editorPanel) this.editorPanel.style.zIndex = '';
    this.view.dom.style.backgroundColor = '';
  }

  // ---- Render loop ---------------------------------------------------------

  private startRenderLoop(): void {
    if (this.rafId !== null) return;
    const tick = () => {
      this.renderFrame();
      this.rafId = requestAnimationFrame(tick);
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private stopRenderLoop(): void {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    // Clear the overlay so no stale blur lingers.
    this.overlayCtx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
  }

  /**
   * Called every animation frame while vis is active.
   * 1. Copy the vis canvas into the blur buffer (with ctx.filter blur).
   * 2. Clip the overlay canvas to the staircase polygons (scroll-adjusted).
   * 3. Draw the blur buffer through the clip mask.
   */
  private renderFrame(): void {
    const ctx = this.overlayCtx;
    const blurCtx = this.blurCtx;
    if (!ctx || !blurCtx || !this.clipPath) return;

    const visCanvas = document.getElementById(VIS_CANVAS_ID) as HTMLCanvasElement | null;
    if (!visCanvas || visCanvas.width === 0 || visCanvas.height === 0) return;

    // Resize overlay canvas pixel buffer to match its CSS layout size.
    const w = this.overlayCanvas.clientWidth;
    const h = this.overlayCanvas.clientHeight;
    if (this.overlayCanvas.width !== w || this.overlayCanvas.height !== h) {
      this.overlayCanvas.width = w;
      this.overlayCanvas.height = h;
    }

    // Resize blur buffer to match the vis canvas.
    if (this.blurBuffer.width !== visCanvas.width || this.blurBuffer.height !== visCanvas.height) {
      this.blurBuffer.width = visCanvas.width;
      this.blurBuffer.height = visCanvas.height;
    }

    // Read settings for this frame.
    const visSettings = getAppSettings().visualisation;
    if (visSettings?.readabilityEnabled === false) {
      ctx.clearRect(0, 0, w, h);
      return;
    }
    const blurRadius = visSettings?.readabilityBlurRadius ?? DEFAULT_BLUR_RADIUS;
    const tintOpacity = visSettings?.readabilityTintOpacity ?? 0;
    const alpha = visSettings?.readabilityAlpha ?? 1;

    // 1. Blur the vis canvas into the offscreen buffer (one GPU op).
    blurCtx.clearRect(0, 0, this.blurBuffer.width, this.blurBuffer.height);
    blurCtx.globalCompositeOperation = 'source-over';
    blurCtx.filter = `blur(${blurRadius}px)`;
    blurCtx.drawImage(visCanvas, 0, 0);
    blurCtx.filter = 'none';

    // 2. Frosted glass tint: paint a solid dark fill *behind* the blurred
    //    waveform content using destination-over, then mask to the original
    //    blurred alpha with destination-in.  This adds an opaque dark
    //    backing that only appears where the blur has content, and the
    //    tintOpacity slider controls how much of it shows through.
    if (tintOpacity > 0) {
      // Draw dark fill behind the existing blurred content.
      blurCtx.globalCompositeOperation = 'destination-over';
      blurCtx.fillStyle = `rgba(0, 0, 0, ${tintOpacity})`;
      blurCtx.fillRect(0, 0, this.blurBuffer.width, this.blurBuffer.height);
      blurCtx.globalCompositeOperation = 'source-over';
    }

    // 3. Clip to the staircase polygons (shifted by scroll delta) and
    //    draw the tinted blur buffer in viewport-fixed coordinates.
    //    globalAlpha controls overall effect intensity.
    ctx.clearRect(0, 0, w, h);
    ctx.save();
    ctx.translate(0, -this.scrollDelta);
    ctx.clip(this.clipPath);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.blurBuffer, 0, this.editorTop, w, h, 0, 0, w, h);
    ctx.restore();
  }

  // ---- Geometry rebuild ----------------------------------------------------

  /** Debounced rebuild — recomputes polygons after scrolling settles. */
  private debouncedRebuild(): void {
    if (this.scrollRebuildTimer !== null) clearTimeout(this.scrollRebuildTimer);
    this.scrollRebuildTimer = setTimeout(() => {
      this.scrollRebuildTimer = null;
      this.scheduleRebuild();
    }, 80);
  }

  private scheduleRebuild(): void {
    const { editorPanel } = this;
    const self = this;
    this.view.requestMeasure({
      read(v: EditorView): MeasureResult {
        const visVisible = isVisPanelVisible();
        const scrollTop = v.scrollDOM.scrollTop;
        const rect = editorPanel?.getBoundingClientRect() ?? null;
        const editorTop = rect?.top ?? 0;
        if (!visVisible) return { lineBounds: [], visVisible, scrollTop, editorTop };
        const lineBounds = computeVisibleLineBoundsViewport(v);
        if (rect) {
          for (const lb of lineBounds) {
            lb.left   -= rect.left;
            lb.right  -= rect.left;
            lb.top    -= rect.top;
            lb.bottom -= rect.top;
          }
        }
        return { lineBounds, visVisible, scrollTop, editorTop };
      },
      write({ lineBounds, visVisible, scrollTop, editorTop }: MeasureResult) {
        self.applyVisState(visVisible);
        self.scrollBaseline = scrollTop;
        self.scrollDelta = 0;
        self.editorTop = editorTop;
        const padding = getAppSettings().visualisation?.readabilityPadding ?? DEFAULT_PADDING;
        self.clipPath = buildClipPath(lineBounds, padding);
      },
    });
  }

  /**
   * When vis is visible: raise the editor panel above the vis, make the CM
   * editor background transparent, and start the render loop.
   * When vis is hidden: restore defaults and stop the render loop.
   */
  private applyVisState(visVisible: boolean): void {
    if (visVisible === this.wasVisVisible) return;
    this.wasVisVisible = visVisible;

    if (visVisible) {
      if (this.editorPanel) this.editorPanel.style.zIndex = EDITOR_RAISED_Z;
      this.view.dom.style.backgroundColor = 'transparent';
      this.startRenderLoop();
    } else {
      if (this.editorPanel) this.editorPanel.style.zIndex = '';
      this.view.dom.style.backgroundColor = '';
      this.stopRenderLoop();
    }
  }
}

/**
 * CodeMirror extension that renders a pre-blurred vis canvas behind the editor
 * text, masked to staircase polygons that hug the code regions.
 *
 * Restructures z-indexes when vis is active:
 *   CM text → overlay canvas (z:-1 inside editor) → editor (z:21) → vis (z:19)
 */
export const visReadabilityPlugin = ViewPlugin.fromClass(VisReadabilityPlugin);
