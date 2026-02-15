import { createSignal, For, Show } from "solid-js";
import type { ChromeProps, ChromeMode, TileSlot, Geometry } from "./types";

/** Predefined layout slot geometries (in viewport percentages). */
const SLOT_GEOMETRIES: Record<TileSlot, Geometry> = {
  "right-third":  { x: 67, y: 5,  w: 31, h: 90 },
  "right-half":   { x: 50, y: 5,  w: 48, h: 90 },
  "bottom-half":  { x: 2,  y: 52, w: 96, h: 46 },
  "bottom-right": { x: 50, y: 52, w: 48, h: 46 },
  "center-large": { x: 10, y: 10, w: 80, h: 80 },
  "top-right":    { x: 50, y: 5,  w: 48, h: 46 },
};

/** Miniature preview rectangles for each slot (relative to a 48x36 thumbnail). */
const SLOT_PREVIEWS: Record<TileSlot, { left: string; top: string; width: string; height: string }> = {
  "right-third":  { left: "66%", top: "5%",  width: "32%", height: "90%" },
  "right-half":   { left: "50%", top: "5%",  width: "48%", height: "90%" },
  "bottom-half":  { left: "2%",  top: "52%", width: "96%", height: "46%" },
  "bottom-right": { left: "50%", top: "52%", width: "48%", height: "46%" },
  "center-large": { left: "10%", top: "10%", width: "80%", height: "80%" },
  "top-right":    { left: "50%", top: "5%",  width: "48%", height: "46%" },
};

const SLOT_NAMES: TileSlot[] = [
  "right-third", "right-half", "bottom-half",
  "bottom-right", "center-large", "top-right",
];

function slotToStyle(slot: TileSlot) {
  const g = SLOT_GEOMETRIES[slot];
  return {
    left:   `${g.x}vw`,
    top:    `${g.y}vh`,
    width:  `${g.w}vw`,
    height: `${g.h}vh`,
  };
}

export function TileChrome(props: ChromeProps) {
  const [currentSlot, setCurrentSlot] = createSignal<TileSlot>("right-third");
  const [mode, setMode] = createSignal<ChromeMode>("normal");
  const [prevSlot, setPrevSlot] = createSignal<TileSlot>("right-third");
  const [pickerOpen, setPickerOpen] = createSignal(false);

  function selectSlot(slot: TileSlot) {
    setCurrentSlot(slot);
    setPickerOpen(false);
    if (mode() !== "normal") setMode("normal");
  }

  function toggleExpand() {
    if (mode() === "expanded") {
      setCurrentSlot(prevSlot());
      setMode("normal");
    } else {
      setPrevSlot(currentSlot());
      setCurrentSlot("center-large");
      setMode("expanded");
    }
  }

  function collapse() {
    if (mode() !== "collapsed") setPrevSlot(currentSlot());
    setMode("collapsed");
  }

  function restore() {
    setCurrentSlot(prevSlot());
    setMode("normal");
  }

  // Stagger collapsed chips so multiple panels don't overlap.
  // Using panelId hash for offset.
  const chipOffset = () => {
    let hash = 0;
    for (const ch of props.panelId) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
    return 48 + (Math.abs(hash) % 4) * 44;
  };

  return (
    <>
      <Show when={mode() === "collapsed"}>
        <div
          class="tile-collapsed-chip"
          style={{ bottom: `${chipOffset()}px` }}
          onClick={restore}
          title={`Restore ${props.title}`}
        >
          {props.title}
        </div>
      </Show>

      <Show when={mode() !== "collapsed"}>
        <div
          class="panel-chrome panel-chrome--tile"
          style={slotToStyle(currentSlot())}
        >
          {/* Title bar */}
          <div class="panel-chrome-title-bar">
            <span class="title-text">{props.title}</span>
            <button
              class="chrome-btn"
              onClick={() => setPickerOpen(!pickerOpen())}
              title="Layout"
            >
              &#9638;
            </button>
            <button class="chrome-btn" onClick={collapse} title="Collapse">_</button>
            <button class="chrome-btn" onClick={toggleExpand} title="Expand">
              {mode() === "expanded" ? "\u25A3" : "\u25A1"}
            </button>
            <button class="chrome-btn" onClick={() => props.onClose()} title="Close">&times;</button>

            {/* Layout picker popover */}
            <Show when={pickerOpen()}>
              <div class="tile-layout-picker">
                <For each={SLOT_NAMES}>
                  {(slot) => (
                    <div
                      class="tile-layout-picker-item"
                      classList={{ active: currentSlot() === slot }}
                      onClick={() => selectSlot(slot)}
                      title={slot}
                    >
                      <div class="slot-preview" style={SLOT_PREVIEWS[slot]} />
                    </div>
                  )}
                </For>
              </div>
            </Show>
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
