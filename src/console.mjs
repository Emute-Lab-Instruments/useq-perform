import { marked } from "marked";

// Console output storage
const consoleLines = [];
const MAX_CONSOLE_LINES = 50;

/**
 * Display a message in the console
 * @param {string} value - Text to display (can include markdown)
 */
export function post(value) {
  console.log("post: " + value);
  consoleLines.push(marked.parse(value));
  
  if (consoleLines.length > MAX_CONSOLE_LINES) {
    consoleLines.shift(); // Remove oldest line
  }
  
  $("#console").html(consoleLines.join(''));
  $('#console').scrollTop($('#console')[0].scrollHeight - $('#console')[0].clientHeight);
}