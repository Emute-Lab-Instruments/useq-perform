// Define a global debug flag
let debug = false;

// Exported function to log messages if debug is enabled
export function dbg(message) {
  if (debug) {
    console.log(message);
  }
}

// Exported function to toggle the debug flag
export function toggleDbg() {
  debug = !debug;
}