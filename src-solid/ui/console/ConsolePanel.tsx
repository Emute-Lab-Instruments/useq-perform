import { For, createEffect, onMount, onCleanup, createSignal } from "solid-js";
import { consoleStore, clearConsole, ConsoleMessageType } from "../../utils/consoleStore";

interface ConsolePanelProps {
  maxHeight?: string;
}

const getMessageColor = (type: ConsoleMessageType): string => {
  switch (type) {
    case "error":
      return "var(--error-color, #ef4444)";
    case "warn":
      return "var(--warning-color, #f59e0b)";
    case "wasm":
      return "var(--wasm-color, #8b5cf6)";
    case "log":
    default:
      return "var(--text-primary, #e2e8f0)";
  }
};

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

  const handleScroll = () => {
    if (!containerRef) return;
    const { scrollTop, scrollHeight, clientHeight } = containerRef;
    // Auto-scroll if user is near bottom (within 50px)
    shouldAutoScroll = scrollHeight - scrollTop - clientHeight < 50;
  };

  createEffect(() => {
    // Trigger on messages change
    const _ = consoleStore.messages.length;
    if (shouldAutoScroll && containerRef) {
      containerRef.scrollTop = containerRef.scrollHeight;
    }
  });

  onMount(() => {
    if (containerRef) {
      containerRef.addEventListener("scroll", handleScroll);
    }
  });

  onCleanup(() => {
    if (containerRef) {
      containerRef.removeEventListener("scroll", handleScroll);
    }
  });

  return (
    <div
      style={{
        display: "flex",
        "flex-direction": "column",
        height: "100%",
        "font-family": "var(--code-font, monospace)",
        "font-size": "0.9em",
        "background-color": "var(--panel-bg, #0f1115)",
        border: "2px solid var(--accent-color, #22c55e)",
        "border-radius": "var(--panel-border-radius, 8px)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          "justify-content": "space-between",
          "align-items": "center",
          padding: "8px 12px",
          "border-bottom": "1px solid var(--border-color, #1e293b)",
          "background-color": "var(--header-bg, rgba(30, 41, 59, 0.5))",
        }}
      >
        <span style={{ "font-weight": 500, color: "var(--text-primary, #e2e8f0)" }}>
          Console
        </span>
        <button
          onClick={clearConsole}
          style={{
            padding: "4px 12px",
            "font-size": "0.85em",
            "background-color": "var(--button-bg, #1e293b)",
            color: "var(--text-primary, #e2e8f0)",
            border: "1px solid var(--border-color, #334155)",
            "border-radius": "4px",
            cursor: "pointer",
            transition: "background-color 0.2s",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--button-hover-bg, #334155)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--button-bg, #1e293b)";
          }}
        >
          Clear
        </button>
      </div>

      <div
        ref={containerRef}
        style={{
          flex: 1,
          "max-height": maxHeight(),
          overflow: "auto",
          padding: "12px",
          "line-height": "1.5",
        }}
      >
        <For each={consoleStore.messages}>
          {(msg) => (
            <div
              style={{
                "margin-bottom": "4px",
                color: getMessageColor(msg.type),
                "word-break": "break-word",
              }}
            >
              <span style={{ "font-weight": "bold" }}>{getMessagePrefix(msg.type)}</span>
              <span innerHTML={msg.content} />
            </div>
          )}
        </For>
        {consoleStore.messages.length === 0 && (
          <div
            style={{
              color: "var(--text-muted, #64748b)",
              "font-style": "italic",
              "text-align": "center",
              "margin-top": "20px",
            }}
          >
            No messages yet...
          </div>
        )}
      </div>
    </div>
  );
}
