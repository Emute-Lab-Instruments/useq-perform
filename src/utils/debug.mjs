// Define a global debug flag
let debug = false;

// Exported function to log messages if debug is enabled
export function dbg(...args) {
  if (!debug) return;

  if (args.length === 1) {
    console.log(args[0]);
  } else if (args.length === 2) {
    console.log(`[${args[0]}]`, args[1]);
  } else if (args.length === 3) {
    console.log(`[${args[0]}][${args[1]}]`, args[2]);
  } else {
    console.log("[DEBUG]", ...args);
  }
}

// Exported function to toggle the debug flag
export function toggleDbg() {
  console.log("Debug mode toggled");
  debug = !debug;
}