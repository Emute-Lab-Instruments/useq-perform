import { createSignal, Show } from "solid-js";
import type { ChromeProps, ChromeMode, Geometry } from "./types";
import { usePointerDrag } from "./usePointerDrag";

const MIN_W = 240;
const MIN_H = 180;

const EXPAND_W = () => window.innerWidth * 0.9;
const EXPAND_H = () => window.innerHeight * 0.9;

function defaultGeometry(): Geometry {
  const w = Math.min(480, window.innerWidth * 0.35);
  const h = window.innerHeight * 0.7;
  return {
    x: window.innerWidth - w - 16,
    y: (window.innerHeight - h) / 2,
    w,
    h,
  };
}

type ResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

export function PaneChrome(props: ChromeProps) {
  const [geo, setGeo] = createSignal<Geometry>(defaultGeometry());
  const [mode, setMode] = createSignal<ChromeMode>("normal");
  const [prevGeo, setPrevGeo] = createSignal<Geometry>(defaultGeometry());

  // ---- Title bar drag (move) ----
  const titleDrag = usePointerDrag({
    onStart: () => { setPrevGeo(geo()); },
    onMove: (_e, dx, dy) => {
      const prev = prevGeo();
      setGeo({ ...prev, x: prev.x + dx, y: prev.y + dy });
    },
  });

  // ---- Edge / corner resize ----
  function makeResizeDrag(edge: ResizeEdge) {
    return usePointerDrag({
      onStart: () => { setPrevGeo(geo()); },
      onMove: (_e, dx, dy) => {
        const p = prevGeo();
        let { x, y, w, h } = p;

        if (edge.includes("w")) { x = p.x + dx; w = p.w - dx; }
        if (edge.includes("e")) { w = p.w + dx; }
        if (edge.includes("n")) { y = p.y + dy; h = p.h - dy; }
        if (edge.includes("s")) { h = p.h + dy; }

        // Clamp minimums
        if (w < MIN_W) { if (edge.includes("w")) x = p.x + p.w - MIN_W; w = MIN_W; }
        if (h < MIN_H) { if (edge.includes("n")) y = p.y + p.h - MIN_H; h = MIN_H; }

        setGeo({ x, y, w, h });
      },
    });
  }

  const resizeN  = makeResizeDrag("n");
  const resizeS  = makeResizeDrag("s");
  const resizeE  = makeResizeDrag("e");
  const resizeW  = makeResizeDrag("w");
  const resizeNW = makeResizeDrag("nw");
  const resizeNE = makeResizeDrag("ne");
  const resizeSW = makeResizeDrag("sw");
  const resizeSE = makeResizeDrag("se");

  // ---- Mode transitions ----
  function toggleExpand() {
    if (mode() === "expanded") {
      setMode("normal");
      setGeo(prevGeo());
    } else {
      setPrevGeo(geo());
      const ew = EXPAND_W();
      const eh = EXPAND_H();
      setGeo({
        x: (window.innerWidth - ew) / 2,
        y: (window.innerHeight - eh) / 2,
        w: ew,
        h: eh,
      });
      setMode("expanded");
    }
  }

  function collapse() {
    if (mode() !== "collapsed") setPrevGeo(geo());
    setMode("collapsed");
  }

  function restore() {
    setGeo(prevGeo());
    setMode("normal");
  }

  // ---- Render ----

  return (
    <>
      <Show when={mode() === "collapsed"}>
        <div
          class="pane-collapsed-chip"
          style={{ top: `${prevGeo().y}px` }}
          onClick={restore}
          title={`Restore ${props.title}`}
        >
          {props.title.slice(0, 3)}
        </div>
      </Show>

      <Show when={mode() !== "collapsed"}>
        <div
          class="panel-chrome panel-chrome--pane"
          style={{
            left: `${geo().x}px`,
            top: `${geo().y}px`,
            width: `${geo().w}px`,
            height: `${geo().h}px`,
          }}
        >
          {/* Resize zones */}
          <div class="pane-resize-zone pane-resize-zone--n"  onPointerDown={resizeN} />
          <div class="pane-resize-zone pane-resize-zone--s"  onPointerDown={resizeS} />
          <div class="pane-resize-zone pane-resize-zone--e"  onPointerDown={resizeE} />
          <div class="pane-resize-zone pane-resize-zone--w"  onPointerDown={resizeW} />
          <div class="pane-resize-zone pane-resize-zone--nw" onPointerDown={resizeNW} />
          <div class="pane-resize-zone pane-resize-zone--ne" onPointerDown={resizeNE} />
          <div class="pane-resize-zone pane-resize-zone--sw" onPointerDown={resizeSW} />
          <div class="pane-resize-zone pane-resize-zone--se" onPointerDown={resizeSE} />

          {/* Title bar */}
          <div class="panel-chrome-title-bar" onPointerDown={titleDrag}>
            <span class="title-text">{props.title}</span>
            <button class="chrome-btn" onClick={collapse} title="Collapse">_</button>
            <button class="chrome-btn" onClick={toggleExpand} title="Expand">
              {mode() === "expanded" ? "\u25A3" : "\u25A1"}
            </button>
            <button class="chrome-btn" onClick={() => props.onClose()} title="Close">&times;</button>
          </div>

          {/* Content */}
          <div class="panel-chrome-content">
            {props.children}
          </div>
        </div>
      </Show>
    </>
  );
}
