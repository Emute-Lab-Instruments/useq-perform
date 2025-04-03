import { marked } from "marked";

// Console output storage
const consoleLines = [];
const MAX_CONSOLE_LINES = 1000; // Increased from 50 to 1000 since we'll have scrolling

/**
 * Display a message in the console
 * @param {string} value - Text to display (can include markdown)
 */
export function post(value) {
  consoleLines.push('<span style="color: var(--accent-color); font-weight: bold; display: inline;">> </span>' + marked.parse(value).replace(/^<p>|<\/p>$/g, ''));

  if (consoleLines.length > MAX_CONSOLE_LINES) {
    consoleLines.shift(); // Remove oldest line
  }

  const consolePanel = document.getElementById('panel-console');
  if (!consolePanel) {
    console.warn('Console panel not found, buffering message:', value);
    return;
  }

  consolePanel.innerHTML = consoleLines.join('');

  // Only try to scroll if the panel exists and has scrollHeight
  if (consolePanel.scrollHeight !== undefined) {
    consolePanel.scrollTop = consolePanel.scrollHeight - consolePanel.clientHeight;
  }
}