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

const MAX_CONSOLE_LINES = 1000;

const initialState: ConsoleState = {
  messages: [],
  nextId: 1,
};

export const [consoleStore, setConsoleStore] = createStore(initialState);

export const addConsoleMessage = (
  content: string,
  type: ConsoleMessageType = "log"
) => {
  const newMessage: ConsoleMessage = {
    id: consoleStore.nextId,
    type,
    content,
    timestamp: Date.now(),
  };

  setConsoleStore("messages", (msgs) => {
    const next = [...msgs, newMessage];
    if (next.length > MAX_CONSOLE_LINES) {
      return next.slice(next.length - MAX_CONSOLE_LINES);
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
