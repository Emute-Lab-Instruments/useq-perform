import { createSignal, Show } from "solid-js";
import type { ChromeProps, ChromeMode } from "./types";
import { usePointerDrag } from "./usePointerDrag";

const MIN_PCT = 20;
const MAX_PCT = 80;
const EXPAND_PCT = 95;

export function DrawerChrome(props: ChromeProps) {
  const [widthPct, setWidthPct] = createSignal(35);
  const [mode, setMode] = createSignal<ChromeMode>("normal");
  const [prevWidthPct, setPrevWidthPct] = createSignal(35);

  // ---- Left-edge drag (width) ----
  let startWidthPx = 0;
  const edgeDrag = usePointerDrag({
    onStart: () => {
      startWidthPx = (widthPct() / 100) * window.innerWidth;
    },
    onMove: (_e, dx) => {
      const newPx = startWidthPx - dx;
      const pct = Math.max(MIN_PCT, Math.min(MAX_PCT, (newPx / window.innerWidth) * 100));
      setWidthPct(pct);
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
        <div class="drawer-collapsed-tab" onClick={restore} title={`Open ${props.title}`}>
          {props.title}
        </div>
      </Show>

      <Show when={mode() !== "collapsed"}>
        <div
          class="panel-chrome panel-chrome--drawer"
          style={{ width: `${widthPct()}%` }}
        >
          {/* Left-edge resize handle */}
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
