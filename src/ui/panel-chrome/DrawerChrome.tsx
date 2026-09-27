import { createSignal, Show } from "solid-js";
import type { ChromeProps, ChromeMode } from "./types";
import { usePointerDrag } from "./usePointerDrag";
import { isNarrowViewport, loadDrawerWidthPct, saveDrawerWidthPct } from "./geometry";

const MIN_PCT = 20;
const MAX_PCT = 80;
const EXPAND_PCT = 95;
const DEFAULT_PCT = 35;

const clampPct = (pct: number) => Math.max(MIN_PCT, Math.min(MAX_PCT, pct));

export function DrawerChrome(props: ChromeProps) {
  const side = () => props.side ?? "right";
  const initialPct = clampPct(loadDrawerWidthPct(props.panelId) ?? DEFAULT_PCT);
  const [widthPct, setWidthPct] = createSignal(initialPct);
  const [mode, setMode] = createSignal<ChromeMode>("normal");
  const [prevWidthPct, setPrevWidthPct] = createSignal(initialPct);

  // ---- Inner-edge drag (width) ----
  // The resize handle sits on the edge facing the editor, so dragging it
  // towards the viewport centre widens the drawer on either side.
  let startWidthPx = 0;
  const edgeDrag = usePointerDrag({
    onStart: () => {
      if (isNarrowViewport()) return false;
      startWidthPx = (widthPct() / 100) * window.innerWidth;
    },
    onMove: (_e, dx) => {
      const newPx = side() === "left" ? startWidthPx + dx : startWidthPx - dx;
      setWidthPct(clampPct((newPx / window.innerWidth) * 100));
    },
    onEnd: () => {
      if (mode() === "normal") saveDrawerWidthPct(props.panelId, widthPct());
    },
  });

  // ---- Mode transitions ----
  function toggleExpand() {
    if (mode() === "expanded") {
      setWidthPct(prevWidthPct());
      setMode("normal");
    } else {
      setPrevWidthPct(widthPct());
      setWidthPct(EXPAND_PCT);
      setMode("expanded");
    }
  }

  function collapse() {
    if (mode() !== "collapsed") setPrevWidthPct(widthPct());
    setMode("collapsed");
  }

  function restore() {
    setWidthPct(prevWidthPct());
    setMode("normal");
  }

  return (
    <>
      <Show when={mode() === "collapsed"}>
        <div
          class={`drawer-collapsed-tab drawer-collapsed-tab--${side()}`}
          onClick={restore}
          title={`Open ${props.title}`}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); restore(); } }}
        >
          {props.title}
        </div>
      </Show>

      <Show when={mode() !== "collapsed"}>
        <div
          class={`panel-chrome panel-chrome--drawer panel-chrome--drawer-${side()}`}
          style={{ width: `${widthPct()}%`, "--panel-stack": String(props.stackIndex ?? 0) }}
          data-panel-id={props.panelId}
        >
          {/* Inner-edge resize handle */}
          <div class="drawer-resize-edge" onPointerDown={edgeDrag} />

          {/* Title bar */}
          <div class="panel-chrome-title-bar">
            <span class="title-text">{props.title}</span>
            <button class="chrome-btn" onClick={collapse} title="Collapse" aria-label="Collapse">&laquo;</button>
            <button class="chrome-btn" onClick={toggleExpand} title="Expand" aria-label="Expand">
              {mode() === "expanded" ? "\u25C0" : "\u25B6"}
            </button>
            <button class="chrome-btn" onClick={() => props.onClose()} title="Close" aria-label="Close">&times;</button>
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
