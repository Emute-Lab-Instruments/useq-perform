import {
  Decoration,
  EditorView,
  WidgetType,
  type DecorationSet,
} from "@codemirror/view";

import { drawProbeWaveformGL, releaseProbeGLState } from "../../../ui/visualisation/webglLineRenderer.ts";
import { collectTemporalWrappers } from "../probeHelpers.ts";
import { buildStaleRender } from "./probeModel.ts";
import {
  MAX_PROBE_WINDOW_DURATION_MS,
  MIN_PROBE_WINDOW_DURATION_MS,
  type FromListHighlight,
  type PersistedProbeSpec,
  type ProbeFieldValue,
  type ProbeRenderData,
} from "./probeTypes.ts";

const PROBE_ACCENT_REFRESH_INTERVAL_MS = 250;
let cachedAccentColor: string | null = null;
let lastAccentColorRead = 0;

export function getProbeAccentColor(): string {
  const now = window.performance?.now?.() ?? Date.now();
  if (
    cachedAccentColor !== null &&
    now - lastAccentColorRead <= PROBE_ACCENT_REFRESH_INTERVAL_MS
  ) {
    return cachedAccentColor;
  }
  const computed = getComputedStyle(document.documentElement).getPropertyValue(
    "--accent-color",
  );
  cachedAccentColor = (computed && computed.trim()) || "#00ff41";
  lastAccentColorRead = now;
  return cachedAccentColor;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  render: ProbeRenderData,
  lineWidth: number,
): void {
  drawProbeWaveformGL(canvas, {
    samples: render.samples,
    color: getProbeAccentColor(),
    lineWidth,
    backgroundColor: "rgba(13, 18, 24, 0.94)",
  });
}

interface ProbeDOMElements {
  root: HTMLElement;
  canvas: HTMLCanvasElement | null;
  textEl: HTMLElement | null;
  depthLabel: HTMLElement;
  leftCaret: HTMLButtonElement | null;
  rightCaret: HTMLButtonElement | null;
  windowDurationSlider: HTMLInputElement | null;
  windowDurationValue: HTMLElement | null;
}

const probeDOMRegistry = new Map<string, ProbeDOMElements>();

export function getProbeRoot(id: string): HTMLElement | undefined {
  return probeDOMRegistry.get(id)?.root;
}

export function previewProbeDepth(
  id: string,
  depth: number,
  maxDepth: number,
): void {
  const elements = probeDOMRegistry.get(id);
  if (!elements) return;
  elements.depthLabel.textContent = `${depth}/${maxDepth}`;
  if (elements.leftCaret) elements.leftCaret.disabled = depth <= 0;
  if (elements.rightCaret) elements.rightCaret.disabled = depth >= maxDepth;
}

export function previewProbeWindowDuration(
  id: string,
  durationMs: number,
): void {
  const elements = probeDOMRegistry.get(id);
  if (elements?.windowDurationValue) {
    elements.windowDurationValue.textContent = `${durationMs}ms`;
  }
}

export class ProbeContextLineRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly onScroll: () => void;
  private readonly onWindowResize: () => void;
  private probes: readonly PersistedProbeSpec[] = [];

  constructor(private readonly view: EditorView) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "cm-probe-context-lines";
    this.view.scrollDOM.appendChild(this.canvas);
    this.onScroll = () => this.draw(this.probes);
    this.onWindowResize = () => this.draw(this.probes);
    this.view.scrollDOM.addEventListener("scroll", this.onScroll);
    window.addEventListener("resize", this.onWindowResize);
  }

  destroy(): void {
    this.canvas.remove();
    this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
    window.removeEventListener("resize", this.onWindowResize);
  }

  draw(probes: readonly PersistedProbeSpec[]): void {
    this.probes = probes;
    const scroller = this.view.scrollDOM;
    const scrollerRect = scroller.getBoundingClientRect();
    const contentWidth = scroller.scrollWidth;
    const contentHeight = scroller.scrollHeight;
    const dpr = window.devicePixelRatio || 1;

    if (
      this.canvas.width !== contentWidth * dpr ||
      this.canvas.height !== contentHeight * dpr
    ) {
      this.canvas.width = contentWidth * dpr;
      this.canvas.height = contentHeight * dpr;
      this.canvas.style.width = `${contentWidth}px`;
      this.canvas.style.height = `${contentHeight}px`;
    }

    const context = this.canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, contentWidth, contentHeight);

    for (const probe of probes) {
      if (probe.mode !== "contextual" || probe.depth <= 0) continue;
      const wrappers = collectTemporalWrappers(
        this.view.state,
        { from: probe.from, to: probe.to },
      );
      const targetWrapper = wrappers[probe.depth - 1];
      if (!targetWrapper) continue;

      const nameCoords = this.view.coordsAtPos(targetWrapper.nameFrom);
      const nameEndCoords = this.view.coordsAtPos(targetWrapper.nameTo);
      const probeRoot = getProbeRoot(probe.id);
      if (!nameCoords || !nameEndCoords || !probeRoot) continue;
      const widgetRect = probeRoot.getBoundingClientRect();
      if (widgetRect.width === 0 && widgetRect.height === 0) continue;

      const nameCenterX =
        (nameCoords.left + nameEndCoords.right) / 2 -
        scrollerRect.left +
        scroller.scrollLeft;
      const nameCenterY =
        (nameCoords.top + nameCoords.bottom) / 2 -
        scrollerRect.top +
        scroller.scrollTop;
      const widgetCenterX =
        (widgetRect.left + widgetRect.right) / 2 -
        scrollerRect.left +
        scroller.scrollLeft;
      const widgetTopY =
        widgetRect.top - scrollerRect.top + scroller.scrollTop;

      context.save();
      context.strokeStyle = getProbeAccentColor();
      context.globalAlpha = 0.35;
      context.lineWidth = 1.5;
      context.setLineDash([4, 4]);
      context.beginPath();
      context.moveTo(nameCenterX, nameCenterY);
      context.lineTo(widgetCenterX, widgetTopY);
      context.stroke();
      context.globalAlpha = 0.5;
      context.setLineDash([]);
      context.fillStyle = getProbeAccentColor();
      context.beginPath();
      context.arc(nameCenterX, nameCenterY, 2.5, 0, Math.PI * 2);
      context.fill();
      context.restore();
    }
  }
}

export function updateProbeDOM(
  id: string,
  probe: PersistedProbeSpec,
  render: ProbeRenderData | null,
  lineWidth: number,
): void {
  const elements = probeDOMRegistry.get(id);
  if (!elements) return;

  elements.depthLabel.textContent = probe.mode === "raw"
    ? "raw"
    : `${probe.depth}/${probe.maxDepth}`;
  if (elements.leftCaret) elements.leftCaret.disabled = probe.depth <= 0;
  if (elements.rightCaret) elements.rightCaret.disabled = probe.depth >= probe.maxDepth;
  if (elements.windowDurationSlider) {
    elements.windowDurationSlider.value = String(probe.windowDurationMs);
  }
  if (elements.windowDurationValue) {
    elements.windowDurationValue.textContent = `${probe.windowDurationMs}ms`;
  }

  if (!render || render.kind === "loading") {
    if (elements.canvas) {
      releaseProbeGLState(elements.canvas);
      elements.canvas.remove();
      elements.canvas = null;
    }
    if (!elements.textEl) {
      const text = document.createElement("span");
      text.className = "cm-probe-widget-text";
      text.textContent = "sampling...";
      elements.root.querySelector(".cm-probe-widget-body")?.prepend(text);
      elements.textEl = text;
    } else {
      elements.textEl.textContent = "sampling...";
      elements.textEl.className = "cm-probe-widget-text";
    }
    return;
  }

  if (render.kind === "waveform") {
    if (elements.textEl) {
      elements.textEl.remove();
      elements.textEl = null;
    }
    if (!elements.canvas) {
      const canvas = document.createElement("canvas");
      elements.root.querySelector(".cm-probe-widget-body")?.prepend(canvas);
      elements.canvas = canvas;
    }
    const canvas = elements.canvas;
    if (canvas.width !== probe.canvasWidth || canvas.height !== probe.canvasHeight) {
      canvas.width = probe.canvasWidth;
      canvas.height = probe.canvasHeight;
    }
    drawWaveform(canvas, render, lineWidth);
    return;
  }

  if (elements.canvas) {
    releaseProbeGLState(elements.canvas);
    elements.canvas.remove();
    elements.canvas = null;
  }
  if (!elements.textEl) {
    const text = document.createElement("span");
    elements.root.querySelector(".cm-probe-widget-body")?.prepend(text);
    elements.textEl = text;
  }
  elements.textEl.className = `cm-probe-widget-text is-${render.kind}`;
  elements.textEl.innerHTML = escapeHtml(render.text);
  if (render.kind === "stale") {
    elements.textEl.title = "Probe text changed since it was saved — delete and recreate the probe.";
  } else {
    elements.textEl.removeAttribute("title");
  }
}

class ProbeWidget extends WidgetType {
  constructor(
    private readonly probe: PersistedProbeSpec,
    private readonly render: ProbeRenderData | null,
    private readonly lineWidth: number,
  ) {
    super();
  }

  eq(other: ProbeWidget): boolean {
    return this.probe.id === other.probe.id;
  }

  toDOM(): HTMLElement {
    const root = document.createElement("span");
    root.className = "cm-probe-widget";
    root.dataset.probeId = this.probe.id;

    const chrome = document.createElement("span");
    chrome.className = "cm-probe-widget-chrome";
    const depthOverlay = document.createElement("span");
    depthOverlay.className = "cm-probe-depth-overlay";
    const depthLabel = document.createElement("span");
    depthLabel.className = "cm-probe-depth-label";
    depthLabel.textContent = this.probe.mode === "raw"
      ? "raw"
      : `${this.probe.depth}/${this.probe.maxDepth}`;
    depthOverlay.appendChild(depthLabel);

    let leftCaret: HTMLButtonElement | null = null;
    let rightCaret: HTMLButtonElement | null = null;
    if (this.probe.mode === "contextual" && this.probe.maxDepth > 0) {
      leftCaret = document.createElement("button");
      leftCaret.type = "button";
      leftCaret.className = "cm-probe-caret-btn";
      leftCaret.dataset.probeId = this.probe.id;
      leftCaret.dataset.delta = "-1";
      leftCaret.title = "Decrease context depth";
      leftCaret.setAttribute("aria-label", "Decrease context depth");
      leftCaret.textContent = "‹";
      leftCaret.disabled = this.probe.depth <= 0;
      depthOverlay.appendChild(leftCaret);

      rightCaret = document.createElement("button");
      rightCaret.type = "button";
      rightCaret.className = "cm-probe-caret-btn";
      rightCaret.dataset.probeId = this.probe.id;
      rightCaret.dataset.delta = "1";
      rightCaret.title = "Increase context depth";
      rightCaret.setAttribute("aria-label", "Increase context depth");
      rightCaret.textContent = "›";
      rightCaret.disabled = this.probe.depth >= this.probe.maxDepth;
      depthOverlay.appendChild(rightCaret);
    }
    chrome.appendChild(depthOverlay);

    const close = document.createElement("button");
    close.type = "button";
    close.className = "cm-probe-close-btn";
    close.dataset.probeId = this.probe.id;
    close.title = "Remove probe";
    close.setAttribute("aria-label", "Remove probe");
    close.textContent = "×";
    chrome.appendChild(close);

    const body = document.createElement("span");
    body.className = "cm-probe-widget-body";
    let canvas: HTMLCanvasElement | null = null;
    let textEl: HTMLElement | null = null;
    if (!this.render || this.render.kind === "loading") {
      textEl = document.createElement("span");
      textEl.className = "cm-probe-widget-text";
      textEl.textContent = "sampling...";
      body.appendChild(textEl);
    } else if (this.render.kind === "waveform") {
      canvas = document.createElement("canvas");
      canvas.width = this.probe.canvasWidth;
      canvas.height = this.probe.canvasHeight;
      drawWaveform(canvas, this.render, this.lineWidth);
      body.appendChild(canvas);
    } else {
      textEl = document.createElement("span");
      textEl.className = `cm-probe-widget-text is-${this.render.kind}`;
      textEl.innerHTML = escapeHtml(this.render.text);
      if (this.render.kind === "stale") {
        textEl.title = "Probe text changed since it was saved — delete and recreate the probe.";
      }
      body.appendChild(textEl);
    }

    const windowDurationContainer = document.createElement("span");
    windowDurationContainer.className = "cm-probe-window-duration";
    const windowDurationSlider = document.createElement("input");
    windowDurationSlider.type = "range";
    windowDurationSlider.className = "cm-probe-window-duration-slider";
    windowDurationSlider.min = String(MIN_PROBE_WINDOW_DURATION_MS);
    windowDurationSlider.max = String(MAX_PROBE_WINDOW_DURATION_MS);
    windowDurationSlider.step = "100";
    windowDurationSlider.value = String(this.probe.windowDurationMs);
    windowDurationSlider.dataset.probeId = this.probe.id;
    windowDurationSlider.title = "Oscilloscope window width (ms)";
    windowDurationSlider.setAttribute("aria-label", "Oscilloscope window width in milliseconds");
    windowDurationContainer.appendChild(windowDurationSlider);
    const windowDurationValue = document.createElement("span");
    windowDurationValue.className = "cm-probe-window-duration-value";
    windowDurationValue.textContent = `${this.probe.windowDurationMs}ms`;
    windowDurationContainer.appendChild(windowDurationValue);

    root.append(chrome, body, windowDurationContainer);
    probeDOMRegistry.set(this.probe.id, {
      root,
      canvas,
      textEl,
      depthLabel,
      leftCaret,
      rightCaret,
      windowDurationSlider,
      windowDurationValue,
    });
    return root;
  }

  destroy(dom: HTMLElement): void {
    const id = dom.dataset.probeId;
    if (!id) return;
    const elements = probeDOMRegistry.get(id);
    if (elements?.canvas) releaseProbeGLState(elements.canvas);
    probeDOMRegistry.delete(id);
  }
}

function buildDecorations(
  snapshot: ProbeFieldValue,
  lineWidth: number,
): DecorationSet {
  const decorations = [];
  for (const highlight of snapshot.highlights) {
    const className = highlight.mode === "raw"
      ? "cm-probe-indexed-item cm-probe-indexed-item-raw"
      : "cm-probe-indexed-item cm-probe-indexed-item-contextual";
    decorations.push(
      Decoration.mark({ class: className }).range(highlight.from, highlight.to),
    );
  }
  for (const probe of snapshot.probes) {
    const render = snapshot.staleIds.has(probe.id)
      ? buildStaleRender(probe)
      : (snapshot.renderById[probe.id] ?? null);
    decorations.push(
      Decoration.widget({
        widget: new ProbeWidget(probe, render, lineWidth),
        side: 1,
      }).range(probe.to),
    );
  }
  return decorations.length > 0
    ? Decoration.set(decorations, true)
    : Decoration.none;
}

export function buildProbeSnapshot(
  probes: PersistedProbeSpec[],
  renderById: Record<string, ProbeRenderData>,
  highlights: FromListHighlight[],
  lineWidth: number,
  staleIds: Set<string> = new Set(),
): ProbeFieldValue {
  const snapshot: ProbeFieldValue = {
    probes,
    renderById,
    highlights,
    decorations: Decoration.none,
    staleIds,
  };
  snapshot.decorations = buildDecorations(snapshot, lineWidth);
  return snapshot;
}
