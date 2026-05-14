/**
 * visReadability — pre-blurred canvas readability layer for the CodeMirror editor.
 *
 * When the visualisation canvas overlays the editor, text can be hard to read
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
import { getAppSettings, subscribeAppSettings } from "../../runtime/appSettingsRepository";

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
 * Computes PixelLineBounds for visible lines plus an overscan buffer.
 *
 * Lines inside the CM viewport get precise coords via `coordsAtPos`.
 * Lines in the overscan zone (beyond the viewport) get estimated coords
 * using `lineBlockAt` (document-space) converted to viewport-space.
 */
function computeVisibleLineBoundsViewport(view: EditorView, overscan: number): PixelLineBounds[] {
  const { from: vpFrom, to: vpTo } = view.viewport;
  const doc = view.state.doc;
  const scrollRect = view.scrollDOM.getBoundingClientRect();
  const scrollTop = view.scrollDOM.scrollTop;
  const charWidth = view.defaultCharacterWidth;

  // Determine line range: viewport lines plus overscan.
  const vpFirstLine = doc.lineAt(vpFrom).number;
  const vpLastLine  = doc.lineAt(vpTo).number;
  const firstLine = Math.max(1, vpFirstLine - overscan);
  const lastLine  = Math.min(doc.lines, vpLastLine + overscan);

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

const EDITOR_RAISED_Z = '21';
const VIS_CANVAS_ID = 'serialcanvas-gl';

// ---------------------------------------------------------------------------
// afterPaint registration — lets the vis render loop call us synchronously
// within the same rAF tick, so we always read a valid drawing buffer.
// ---------------------------------------------------------------------------

let activePlugin: VisReadabilityPlugin | null = null;

export function readabilityAfterPaint(): void {
  activePlugin?.renderFrame();
}

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

/** Check if readability is enabled in current settings. */
function isReadabilityEnabled(): boolean {
  return getAppSettings().visualisation?.readabilityEnabled !== false;
}

interface MeasureResult {
  lineBounds: PixelLineBounds[];
  visVisible: boolean;
  /** The scrollDOM.scrollTop at the time of measurement. */
  scrollTop: number;
}

// ---------------------------------------------------------------------------
// ViewPlugin
// ---------------------------------------------------------------------------

class VisReadabilityPlugin {
  private overlayCanvas: HTMLCanvasElement;
  private overlayCtx: CanvasRenderingContext2D | null;
  private blurBuffer: HTMLCanvasElement;
  private blurCtx: CanvasRenderingContext2D | null;
  /** Offscreen canvas for the feathered polygon mask. */
  private maskBuffer: HTMLCanvasElement;
  private maskCtx: CanvasRenderingContext2D | null;
  private view: EditorView;
  private mutationObserver: MutationObserver;
  private resizeObserver: ResizeObserver | null = null;
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
  /** Unsubscribe from app settings changes. */
  private unsubSettings: (() => void) | null = null;
  /** Whether readability was enabled the last time we checked. */
  private wasEnabled = true;

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

    // Offscreen buffer for the feathered polygon mask.
    this.maskBuffer = document.createElement('canvas');
    this.maskCtx = this.maskBuffer.getContext('2d');

    this.editorPanel = document.getElementById('panel-main-editor');
    (this.editorPanel ?? document.body).appendChild(this.overlayCanvas);

    // Track scroll: update delta for the render loop, and debounce a
    // full polygon rebuild for newly-scrolled-in lines.
    this.handleScroll = () => {
      if (!this.wasVisVisible || !this.wasEnabled) return;
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

    // Rebuild when the editor panel resizes (e.g. opening/closing devtools)
    // so that polygon positions stay in sync with the canvas.
    if (this.editorPanel) {
      this.resizeObserver = new ResizeObserver(() => {
        if (this.wasVisVisible && this.wasEnabled) this.scheduleRebuild();
      });
      this.resizeObserver.observe(this.editorPanel);
    }

    // Rebuild polygons when settings change (padding, etc.).
    this.unsubSettings = subscribeAppSettings(() => {
      const enabled = isReadabilityEnabled();
      if (enabled !== this.wasEnabled) {
        this.wasEnabled = enabled;
        if (!enabled) {
          this.overlayCtx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
        }
      }
      if (this.wasVisVisible) this.scheduleRebuild();
    });

    this.wasEnabled = isReadabilityEnabled();
    this.scheduleRebuild();
  }

  update(update: ViewUpdate): void {
    this.view = update.view;
    // Only rebuild polygons when vis is active AND readability is enabled.
    if (!this.wasVisVisible || !this.wasEnabled) return;
    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      this.scheduleRebuild();
    }
  }

  destroy(): void {
    if (activePlugin === this) activePlugin = null;
    this.overlayCtx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
    if (this.scrollRebuildTimer !== null) clearTimeout(this.scrollRebuildTimer);
    this.unsubSettings?.();
    this.resizeObserver?.disconnect();
    this.view.scrollDOM.removeEventListener('scroll', this.handleScroll);
    this.mutationObserver.disconnect();
    this.overlayCanvas.remove();
    if (this.editorPanel) this.editorPanel.style.zIndex = '';
    this.view.dom.style.backgroundColor = '';
  }

  // ---- Render (called from vis afterPaint hook) ----------------------------

  /**
   * Called synchronously after the vis renderer paints, within the same rAF.
   * 1. Copy the vis canvas into the blur buffer (with ctx.filter blur).
   * 2. Clip the overlay canvas to the staircase polygons (scroll-adjusted).
   * 3. Draw the blur buffer through the clip mask.
   */
  renderFrame(): void {
    const ctx = this.overlayCtx;
    if (!ctx) return;
    const blurCtx = this.blurCtx;
    if (!blurCtx || !this.clipPath) {
      ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      return;
    }

    // Check if readability is disabled — skip all GPU work.
    if (!this.wasEnabled) {
      ctx.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
      return;
    }

    const visCanvas = document.getElementById(VIS_CANVAS_ID) as HTMLCanvasElement | null;
    if (!visCanvas || visCanvas.width === 0 || visCanvas.height === 0) return;

    // Resize overlay canvas pixel buffer to match its CSS layout size.
    // Use CSS pixels (not DPR-scaled) to avoid GPU memory explosion.
    const w = this.overlayCanvas.clientWidth;
    const h = this.overlayCanvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.overlayCanvas.width !== w || this.overlayCanvas.height !== h) {
      this.overlayCanvas.width = w;
      this.overlayCanvas.height = h;
    }

    // Resize blur buffer to CSS pixel size of the overlay (NOT the DPR-scaled
    // vis canvas size).  The blur is intentionally soft, so CSS resolution is
    // plenty.  This keeps GPU memory reasonable on HiDPI displays.
    if (this.blurBuffer.width !== w || this.blurBuffer.height !== h) {
      this.blurBuffer.width = w;
      this.blurBuffer.height = h;
    }

    // Read settings for this frame.
    const visSettings = getAppSettings().visualisation;
    const blurRadius = visSettings?.readabilityBlurRadius ?? 10;
    const tintOpacity = visSettings?.readabilityTintOpacity ?? 0;
    const alpha = visSettings?.readabilityAlpha ?? 1;
    const passes = Math.max(0, Math.min(5, Math.round(visSettings?.readabilityPasses ?? 2)));

    // Compute the relative offset between the vis canvas and the overlay canvas
    // so the blurred content aligns with the actual vis behind the editor.
    const visRect = visCanvas.getBoundingClientRect();
    const overlayRect = this.overlayCanvas.getBoundingClientRect();
    const offsetX = visRect.left - overlayRect.left;
    const offsetY = visRect.top - overlayRect.top;

    // 1. Blur + darken the vis canvas.
    //    Draw the vis canvas into the blur buffer at the correct relative offset,
    //    scaled from DPR resolution to CSS pixels.
    const maxDarken = Math.max(0, Math.min(1, visSettings?.readabilityMaxDarken ?? 0.85));
    const brightness = 1 - tintOpacity * maxDarken;
    blurCtx.clearRect(0, 0, w, h);
    blurCtx.filter = `blur(${blurRadius}px) brightness(${brightness})`;
    // Draw vis canvas → blur buffer, mapping vis CSS rect into overlay CSS space.
    blurCtx.drawImage(visCanvas, offsetX, offsetY, visRect.width, visRect.height);
    blurCtx.filter = 'none';
    for (let i = 0; i < passes; i++) {
      blurCtx.drawImage(this.blurBuffer, 0, 0);
    }

    // 2. Build a feathered mask from the polygon shapes.
    const feather = Math.max(0, visSettings?.readabilityFeather ?? 4);
    const mCtx = this.maskCtx;
    if (this.maskBuffer.width !== w || this.maskBuffer.height !== h) {
      this.maskBuffer.width = w;
      this.maskBuffer.height = h;
    }
    if (mCtx) {
      mCtx.clearRect(0, 0, w, h);
      mCtx.save();
      mCtx.translate(0, -this.scrollDelta);
      mCtx.fillStyle = '#fff';
      mCtx.fill(this.clipPath!);
      mCtx.restore();
      // Blur the mask for soft edges.
      if (feather > 0) {
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(this.maskBuffer, 0, 0);
        mCtx.clearRect(0, 0, w, h);
        mCtx.filter = `blur(${feather}px)`;
        mCtx.drawImage(this.overlayCanvas, 0, 0);
        mCtx.filter = 'none';
      }
    }

    // 3. Draw the blur buffer to the overlay, then mask with the
    //    feathered polygon shape using destination-in.
    ctx.clearRect(0, 0, w, h);
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.blurBuffer, 0, 0);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.globalAlpha = 1;
    ctx.drawImage(this.maskBuffer, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }

  // ---- Geometry rebuild ----------------------------------------------------

  /** Debounced rebuild — recomputes polygons after scrolling settles. */
  private debouncedRebuild(): void {
    if (this.scrollRebuildTimer !== null) clearTimeout(this.scrollRebuildTimer);
    const delay = Math.max(20, getAppSettings().visualisation?.readabilityDebounceMs ?? 80);
    this.scrollRebuildTimer = setTimeout(() => {
      this.scrollRebuildTimer = null;
      this.scheduleRebuild();
    }, delay);
  }

  private scheduleRebuild(): void {
    const self = this;
    this.view.requestMeasure({
      read(v: EditorView): MeasureResult {
        const visVisible = isVisPanelVisible();
        const scrollTop = v.scrollDOM.scrollTop;
        if (!visVisible || !self.wasEnabled) return { lineBounds: [], visVisible, scrollTop };
        const overscan = Math.max(0, Math.round(getAppSettings().visualisation?.readabilityOverscan ?? 30));
        const lineBounds = computeVisibleLineBoundsViewport(v, overscan);
        const rect = self.editorPanel?.getBoundingClientRect() ?? null;
        if (rect) {
          for (const lb of lineBounds) {
            lb.left   -= rect.left;
            lb.right  -= rect.left;
            lb.top    -= rect.top;
            lb.bottom -= rect.top;
          }
        }
        return { lineBounds, visVisible, scrollTop };
      },
      write({ lineBounds, visVisible, scrollTop }: MeasureResult) {
        self.applyVisState(visVisible);
        self.scrollBaseline = scrollTop;
        self.scrollDelta = 0;
        const padding = getAppSettings().visualisation?.readabilityPadding ?? 3;
        self.clipPath = buildClipPath(lineBounds, padding);
      },
    });
  }

  /**
   * When vis is visible: raise the editor panel above the vis, make the CM
   * editor background transparent, and register for afterPaint callbacks.
   * When vis is hidden: restore defaults and unregister.
   */
  private applyVisState(visVisible: boolean): void {
    if (visVisible === this.wasVisVisible) return;
    this.wasVisVisible = visVisible;

    if (visVisible) {
      if (this.editorPanel) this.editorPanel.style.zIndex = EDITOR_RAISED_Z;
      this.view.dom.style.backgroundColor = 'transparent';
      activePlugin = this;
    } else {
      if (this.editorPanel) this.editorPanel.style.zIndex = '';
      this.view.dom.style.backgroundColor = '';
      if (activePlugin === this) activePlugin = null;
      this.overlayCtx?.clearRect(0, 0, this.overlayCanvas.width, this.overlayCanvas.height);
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
