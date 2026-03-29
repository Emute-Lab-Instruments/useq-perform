/**
 * REPL Console Panel — displays evaluation results and log messages.
 *
 * Positioned in the bottom-right of the editor viewport. Resizable,
 * draggable, and collapsible into a small tab. Uses the theme's CSS
 * variables for all colors so it tracks theme changes automatically.
 */

import {
  For,
  Show,
  createSignal,
  createEffect,
  onCleanup,
  onMount,
} from "solid-js";
import {
  consoleStore,
  clearConsole,
  type ConsoleMessage,
  type ConsoleMessageType,
} from "../../utils/consoleStore.ts";
import { settings as globalSettings } from "../../utils/settingsStore.ts";
import { usePointerDrag } from "../panel-chrome/usePointerDrag.ts";
import type { ConsoleSettings } from "../../lib/settings/schema.ts";
import "./console.css";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const MIN_W = 280;
const MIN_H = 120;
const MARGIN = 16;

interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

function defaultGeometry(): Geometry {
  const w = Math.min(520, window.innerWidth * 0.4);
  const h = Math.min(340, window.innerHeight * 0.35);
  return {
    x: window.innerWidth - w - MARGIN,
    y: window.innerHeight - h - MARGIN,
    w,
    h,
  };
}

// ---------------------------------------------------------------------------
// Typewriter effect
// ---------------------------------------------------------------------------

function TypewriterText(props: {
  text: string;
  charIntervalMs: number;
  onComplete?: () => void;
}) {
  const [visibleChars, setVisibleChars] = createSignal(0);
  let timer: ReturnType<typeof setInterval> | undefined;

  onMount(() => {
    const intervalMs = Math.max(1, props.charIntervalMs);
    timer = setInterval(() => {
      setVisibleChars((n) => {
        const next = n + 1;
        if (next >= props.text.length) {
          clearInterval(timer);
          props.onComplete?.();
          return props.text.length;
        }
        return next;
      });
    }, intervalMs);
  });

  onCleanup(() => clearInterval(timer));

  return (
    <>
      {props.text.slice(0, visibleChars())}
      <Show when={visibleChars() < props.text.length}>
        <span class="console-typewriter-cursor" />
      </Show>
    </>
  );
}

// ---------------------------------------------------------------------------
// Console Entry
// ---------------------------------------------------------------------------

function ConsoleEntry(props: {
  message: ConsoleMessage;
  settings: ConsoleSettings;
  /** ID of the message currently being typewritten (panel-level). */
  typewriterActiveId: () => number | null;
  /** Called when this entry's typewriter finishes. */
  onTypewriterDone: (id: number) => void;
}) {
  const s = () => props.settings;
  const msg = () => props.message;
  const isTypewriter = () => s().entryAnimation === "typewriter";

  /** This entry is the one currently typing. */
  const isActiveTypewriter = () =>
    isTypewriter() && props.typewriterActiveId() === msg().id;

  /** This entry is waiting for an earlier typewriter to finish. */
  const isPendingTypewriter = () => {
    if (!isTypewriter()) return false;
    const activeId = props.typewriterActiveId();
    return activeId !== null && activeId < msg().id;
  };

  /** Typewriter is done (or was never needed) — show full text. */
  const [done, setDone] = createSignal(!isTypewriter());

  const animClass = () => {
    if (isTypewriter()) return "";
    switch (s().entryAnimation) {
      case "slide": return "console-entry--animate-slide";
      case "fade": return "console-entry--animate-fade";
      default: return "";
    }
  };

  const compactClass = () => s().showTypeBadge ? "" : "console-entry--compact";

  const handleComplete = () => {
    setDone(true);
    props.onTypewriterDone(msg().id);
  };

  return (
    <div
      class={`console-entry console-entry--${msg().type} ${animClass()} ${compactClass()}`}
    >
      <Show when={s().showTimestamp}>
        <span class="console-timestamp">
          {new Date(msg().timestamp).toTimeString().slice(0, 8)}
        </span>
      </Show>
      <Show when={s().showTypeBadge} fallback={
        <span class="console-prompt-char">&gt;</span>
      }>
        <span class="console-type-badge">{msg().type}</span>
      </Show>
      <span class="console-entry-content">
        <Show when={msg().type === "wasm"}>
          <span class="console-eval-prefix">{";=>"} </span>
        </Show>
        <Show when={isActiveTypewriter()} fallback={
          <Show when={!isPendingTypewriter() || done()} fallback={
            <span class="console-typewriter-cursor" />
          }>
            <span innerHTML={msg().content} />
          </Show>
        }>
          <TypewriterText
            text={stripHtml(msg().content)}
            charIntervalMs={s().typewriterIntervalMs}
            onComplete={handleComplete}
          />
        </Show>
      </span>
    </div>
  );
}

function stripHtml(html: string): string {
  const tmp = document.createElement("span");
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || "";
}

// ---------------------------------------------------------------------------
// Resize edge component
// ---------------------------------------------------------------------------

type ResizeEdge = "n" | "s" | "e" | "w" | "nw" | "ne" | "sw" | "se";

function ResizeZone(props: {
  edge: ResizeEdge;
  geo: () => Geometry;
  setGeo: (g: Geometry) => void;
}) {
  const drag = usePointerDrag({
    onStart: () => { /* snapshot taken via closure */ },
    onMove: (_e, dx, dy) => {
      const p = startGeo;
      let { x, y, w, h } = p;
      const edge = props.edge;

      if (edge.includes("w")) { x = p.x + dx; w = p.w - dx; }
      if (edge.includes("e")) { w = p.w + dx; }
      if (edge.includes("n")) { y = p.y + dy; h = p.h - dy; }
      if (edge.includes("s")) { h = p.h + dy; }

      if (w < MIN_W) { if (edge.includes("w")) x = p.x + p.w - MIN_W; w = MIN_W; }
      if (h < MIN_H) { if (edge.includes("n")) y = p.y + p.h - MIN_H; h = MIN_H; }

      props.setGeo({ x, y, w, h });
    },
  });

  let startGeo: Geometry;

  const handlePointerDown = (e: PointerEvent) => {
    startGeo = { ...props.geo() };
    drag(e);
  };

  return (
    <div
      class={`console-resize-zone console-resize-zone--${props.edge}`}
      onPointerDown={handlePointerDown}
    />
  );
}

// ---------------------------------------------------------------------------
// Main Console Panel
// ---------------------------------------------------------------------------

export function ConsolePanel() {
  const [geo, setGeo] = createSignal<Geometry>(defaultGeometry());
  const [collapsed, setCollapsed] = createSignal(false);
  const [unreadCount, setUnreadCount] = createSignal(0);
  const [isAutoScrolling, setIsAutoScrolling] = createSignal(true);
  const [showScrollIndicator, setShowScrollIndicator] = createSignal(false);
  /** ID of the message currently being typewritten, or null if idle. */
  const [typewriterActiveId, setTypewriterActiveId] = createSignal<number | null>(null);
  let contentRef: HTMLDivElement | undefined;
  let prevMessageCount = 0;

  const consoleSettings = (): ConsoleSettings =>
    globalSettings.console ?? {
      showTimestamp: true,
      showTypeBadge: true,
      entryAnimation: "slide",
      typewriterIntervalMs: 20,
    };

  /** Called when a typewriter entry finishes — advance to next pending. */
  const onTypewriterDone = (_id: number) => {
    const msgs = consoleStore.messages;
    const currentIdx = msgs.findIndex((m) => m.id === _id);
    if (currentIdx >= 0 && currentIdx < msgs.length - 1) {
      setTypewriterActiveId(msgs[currentIdx + 1].id);
    } else {
      setTypewriterActiveId(null);
    }
  };

  // Auto-scroll on new messages + kick typewriter queue
  createEffect(() => {
    const msgs = consoleStore.messages;
    const count = msgs.length;
    if (count > prevMessageCount) {
      if (collapsed()) {
        setUnreadCount((n) => n + (count - prevMessageCount));
      } else if (isAutoScrolling()) {
        requestAnimationFrame(() => {
          if (contentRef) contentRef.scrollTop = contentRef.scrollHeight;
        });
      }
      // Start typewriter on the first new message if queue is idle
      if (consoleSettings().entryAnimation === "typewriter" && typewriterActiveId() === null) {
        const firstNew = msgs[prevMessageCount];
        if (firstNew) setTypewriterActiveId(firstNew.id);
      }
    }
    prevMessageCount = count;
  });

  // Scroll tracking
  const onScroll = () => {
    if (!contentRef) return;
    const atBottom =
      contentRef.scrollHeight - contentRef.scrollTop - contentRef.clientHeight < 30;
    setIsAutoScrolling(atBottom);
    setShowScrollIndicator(!atBottom);
  };

  const scrollToBottom = () => {
    if (contentRef) contentRef.scrollTop = contentRef.scrollHeight;
    setIsAutoScrolling(true);
    setShowScrollIndicator(false);
  };

  // Title bar drag
  let dragStartGeo: Geometry;
  const titleDrag = usePointerDrag({
    onStart: () => { dragStartGeo = { ...geo() }; },
    onMove: (_e, dx, dy) => {
      setGeo({
        ...dragStartGeo,
        x: dragStartGeo.x + dx,
        y: dragStartGeo.y + dy,
      });
    },
  });

  const handleTitlePointerDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest(".console-chrome-btn, .console-badge")) return;
    titleDrag(e);
  };

  // Collapse / expand
  const collapse = () => {
    setCollapsed(true);
    setUnreadCount(0);
  };

  const expand = () => {
    setCollapsed(false);
    setUnreadCount(0);
    requestAnimationFrame(scrollToBottom);
  };

  // Keep in bounds on window resize
  const onResize = () => {
    const g = geo();
    let changed = false;
    let { x, y } = g;
    if (x + g.w > window.innerWidth) { x = Math.max(0, window.innerWidth - g.w - MARGIN); changed = true; }
    if (y + g.h > window.innerHeight) { y = Math.max(48, window.innerHeight - g.h - MARGIN); changed = true; }
    if (changed) setGeo({ ...g, x, y });
  };

  onMount(() => window.addEventListener("resize", onResize));
  onCleanup(() => window.removeEventListener("resize", onResize));

  const edges: ResizeEdge[] = ["n", "s", "e", "w", "nw", "ne", "sw", "se"];

  return (
    <>
      {/* Expanded panel */}
      <div
        class="console-panel"
        classList={{ "console-panel--hidden": collapsed() }}
        style={{
          left: `${geo().x}px`,
          top: `${geo().y}px`,
          width: `${geo().w}px`,
          height: `${geo().h}px`,
        }}
      >
        {/* Resize zones */}
        <For each={edges}>
          {(edge) => <ResizeZone edge={edge} geo={geo} setGeo={setGeo} />}
        </For>

        {/* Title bar */}
        <div class="console-title-bar" onPointerDown={handleTitlePointerDown}>
          <span class="title-text">
            <span class="title-accent">&gt;</span> console
          </span>
          <span class="spacer" />
          <span class="console-badge">{consoleStore.messages.length}</span>
          <button
            class="console-chrome-btn console-chrome-btn--danger"
            onClick={clearConsole}
            title="Clear"
          >
            &times;
          </button>
          <button
            class="console-chrome-btn"
            onClick={collapse}
            title="Collapse"
          >
            &#9662;
          </button>
        </div>

        {/* Content */}
        <div
          class="console-content"
          ref={contentRef}
          onScroll={onScroll}
        >
          <Show
            when={consoleStore.messages.length > 0}
            fallback={
              <div class="console-empty">
                <span class="console-empty-prompt">_</span>
                <span>awaiting evaluation</span>
              </div>
            }
          >
            <For each={consoleStore.messages}>
              {(msg) => (
                <ConsoleEntry
                  message={msg}
                  settings={consoleSettings()}
                  typewriterActiveId={typewriterActiveId}
                  onTypewriterDone={onTypewriterDone}
                />
              )}
            </For>
          </Show>
        </div>

        {/* Footer */}
        <div class="console-footer">
          <span>modulisp</span>
          <span style={{ color: "var(--accent-color)", opacity: "0.5" }}>wasm</span>
          <span class="spacer" />
          <button
            class="console-scroll-indicator"
            classList={{ "console-scroll-indicator--visible": showScrollIndicator() }}
            onClick={scrollToBottom}
            title="Scroll to bottom"
          >
            &#8595; new messages
          </button>
        </div>
      </div>

      {/* Collapsed tab */}
      <div
        class="console-collapsed-tab"
        classList={{ "console-collapsed-tab--hidden": !collapsed() }}
        onClick={expand}
      >
        <span class="tab-accent">&gt;</span> console
        <Show when={unreadCount() > 0}>
          <span class="console-unread-badge">{unreadCount()}</span>
        </Show>
      </div>
    </>
  );
}
