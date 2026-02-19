import { createEffect, onCleanup } from "solid-js";
import { createVirtualizer } from "@tanstack/solid-virtual";
import { consoleStore, clearConsole, ConsoleMessageType } from "../../utils/consoleStore";
import { sanitizeHtml } from "../../utils/sanitize";
import "./console-panel.css";

interface ConsolePanelProps {
  maxHeight?: string;
}

const getMessagePrefix = (type: ConsoleMessageType): string => {
  switch (type) {
    case "error":
      return "✗ ";
    case "warn":
      return "⚠ ";
    case "wasm":
      return "◈ ";
    case "log":
    default:
      return "> ";
  }
};

export function ConsolePanel(props: ConsolePanelProps) {
  const maxHeight = () => props.maxHeight || "400px";
  let containerRef: HTMLDivElement | undefined;
  let shouldAutoScroll = true;

  const virtualizer = createVirtualizer({
    count: () => consoleStore.messages.length,
    getScrollElement: () => containerRef || null,
    estimateSize: () => 24, // Approximate line height
    overscan: 10,
  });

  const handleScroll = () => {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 50;
  };

  createEffect(() => {
    const messageCount = consoleStore.messages.length;
    if (shouldAutoScroll && containerRef && messageCount > 0) {
      // Scroll to bottom when new messages arrive
      virtualizer.scrollToIndex(messageCount - 1, { align: "end" });
    }
  });

  onCleanup(() => {
    if (containerRef) {
      containerRef.removeEventListener("scroll", handleScroll);
    }
  });

  const items = () => virtualizer.getVirtualItems();

  return (
    <div class="console-panel">
      <div class="console-panel-header">
        <span class="console-panel-count">
          Console ({consoleStore.messages.length})
        </span>
        <button class="console-panel-clear-btn" onClick={clearConsole}>
          Clear
        </button>
      </div>

      <div
        ref={(el) => {
          containerRef = el;
          if (el) {
            el.addEventListener("scroll", handleScroll);
          }
        }}
        class="console-panel-scroll"
        style={{ "max-height": maxHeight() }}
      >
        {consoleStore.messages.length === 0 ? (
          <div class="console-panel-empty">No messages yet...</div>
        ) : (
          <div
            class="console-panel-list"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {items().map((virtualRow) => {
              const msg = consoleStore.messages[virtualRow.index];
              return (
                <div
                  class="console-panel-row"
                  data-type={msg.type}
                  data-index={virtualRow.index}
                  ref={(el) => virtualizer.measureElement(el)}
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <span class="console-panel-prefix">{getMessagePrefix(msg.type)}</span>
                  <span innerHTML={sanitizeHtml(msg.content)} />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
