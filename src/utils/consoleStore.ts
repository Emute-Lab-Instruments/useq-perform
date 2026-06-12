import { createStore } from "solid-js/store";

export type ConsoleMessageType = "log" | "warn" | "error" | "wasm";

export interface ConsoleMessage {
  id: number;
  type: ConsoleMessageType;
  content: string;
  timestamp: number;
}

interface ConsoleState {
  messages: ConsoleMessage[];
  nextId: number;
}

const DEFAULT_CONSOLE_LINES = 1000;
let _maxConsoleLines = DEFAULT_CONSOLE_LINES;

/** Update the console lines limit (called by settings sync). */
export function setMaxConsoleLines(limit: number): void {
  _maxConsoleLines = limit > 0 ? limit : DEFAULT_CONSOLE_LINES;
}

const initialState: ConsoleState = {
  messages: [],
  nextId: 1,
};

export const [consoleStore, setConsoleStore] = createStore(initialState);

/** Lightweight inline markdown: **bold**, *italic*, `code`, and [links](url). */
function inlineMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
}

/**
 * Append a console message. Raw text is escaped and rendered through inline
 * markdown so the stored `content` is always safe HTML — this is the single
 * entry point that produces console entries, so every path is escaped.
 * (`ConsolePanel` renders `content` via `innerHTML`; see console.md §1.4.)
 */
export const addConsoleMessage = (
  content: string,
  type: ConsoleMessageType = "log"
) => {
  const newMessage: ConsoleMessage = {
    id: consoleStore.nextId,
    type,
    content: inlineMarkdown(content),
    timestamp: Date.now(),
  };

  setConsoleStore("messages", (msgs) => {
    const next = [...msgs, newMessage];
    const limit = _maxConsoleLines;
    if (next.length > limit) {
      return next.slice(next.length - limit);
    }
    return next;
  });
  setConsoleStore("nextId", (id) => id + 1);
};

export const clearConsole = () => {
  setConsoleStore("messages", []);
};

export const postToConsole = (content: string) => {
  addConsoleMessage(content, "log");
};

/**
 * Post a message to the console with lightweight inline markdown.
 * Thin alias over {@link addConsoleMessage}; escaping/markdown happens there.
 */
export function post(value: string, type: ConsoleMessageType = "log"): void {
  addConsoleMessage(value, type);
}
