import { marked } from "marked";
import { addConsoleMessage } from "../../utils/consoleStore.ts";

export type ConsoleMessageType = 'log' | 'warn' | 'error' | 'wasm';

/**
 * Display a message in the console.
 * Routes to the Solid console store via direct import.
 */
export function post(value: string, type: ConsoleMessageType = 'log'): void {
  const htmlContent = (marked.parse(value) as string).replace(/^<p>|<\/p>$/g, '');
  addConsoleMessage(htmlContent, type);
}
