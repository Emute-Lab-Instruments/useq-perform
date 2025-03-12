import { marked } from "marked";

// Console output storage
const consoleLines = [];
const MAX_CONSOLE_LINES = 1000; // Increased from 50 to 1000 since we'll have scrolling

/**
 * Display a message in the console
 * @param {string} value - Text to display (can include markdown)
 */
export function post(value) {
  consoleLines.push(marked.parse('`> ' + value + '`'));
  
  if (consoleLines.length > MAX_CONSOLE_LINES) {
    consoleLines.shift(); // Remove oldest line
  }
  
  $("#console").html(consoleLines.join(''));
  $('#console').scrollTop($('#console')[0].scrollHeight - $('#console')[0].clientHeight);
}