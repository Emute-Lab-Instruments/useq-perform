import { marked } from "marked";

// Console output storage (fallback for when Solid console is not mounted)
const consoleLines = [];
const MAX_CONSOLE_LINES = 1000;

/**
 * Display a message in the console
 * Routes to Solid console store if available, otherwise uses legacy rendering
 * @param {string} value - Text to display (can include markdown)
 * @param {string} type - Message type: 'log', 'warn', 'error', 'wasm'
 */
export function post(value, type = 'log') {
  // If Solid console is mounted, use its store
  // Note: Solid ConsolePanel adds its own prefix, so only send the content
  if (typeof window.__solidConsolePost === 'function') {
    const htmlContent = marked.parse(value).replace(/^<p>|<\/p>$/g, '');
    window.__solidConsolePost(htmlContent, type);
    return;
  }

  // Fallback to legacy rendering
  consoleLines.push('<span style="color: var(--accent-color); font-weight: bold; display: inline;">> </span>' + marked.parse(value).replace(/^<p>|<\/p>$/g, ''));

  if (consoleLines.length > MAX_CONSOLE_LINES) {
    consoleLines.shift();
  }

  const consolePanel = document.getElementById('panel-console');
  if (!consolePanel) {
    console.warn('Console panel not found, buffering message:', value);
    return;
  }

  consolePanel.innerHTML = consoleLines.join('');

  if (consolePanel.scrollHeight !== undefined) {
    consolePanel.scrollTop = consolePanel.scrollHeight - consolePanel.clientHeight;
  }
}