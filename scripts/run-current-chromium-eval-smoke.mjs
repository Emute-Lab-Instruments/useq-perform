#!/usr/bin/env node

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function candidateExecutables() {
  const configured = process.env.USEQ_CHROMIUM_PATH;
  if (configured) return [configured];
  if (process.platform === "darwin") {
    return [
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
      "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
      "/Applications/Chromium.app/Contents/MacOS/Chromium",
    ];
  }
  if (process.platform === "win32") {
    const roots = [
      process.env.PROGRAMFILES,
      process.env["PROGRAMFILES(X86)"],
      process.env.LOCALAPPDATA,
    ].filter(Boolean);
    return roots.flatMap((base) => [
      path.join(base, "Google", "Chrome", "Application", "chrome.exe"),
      path.join(base, "Microsoft", "Edge", "Application", "msedge.exe"),
      path.join(base, "Chromium", "Application", "chrome.exe"),
    ]);
  }
  return [
    "/usr/bin/google-chrome-stable",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
    "/usr/bin/microsoft-edge-stable",
  ];
}

const executable = candidateExecutables().find(existsSync);
if (!executable) {
  console.error(
    "No current Chromium-family browser found. Set USEQ_CHROMIUM_PATH to " +
    "Chrome, Chromium, or Edge; this release gate deliberately does not fall " +
    "back to Playwright's older pinned browser.",
  );
  process.exit(2);
}

const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
console.log(`Browser-local eval release gate: ${version.stdout.trim() || executable}`);

const playwrightCli = path.join(root, "node_modules", "@playwright", "test", "cli.js");
const result = spawnSync(
  process.execPath,
  [
    playwrightCli,
    "test",
    "e2e/input-dispatch.spec.ts",
    "--grep",
    "eval.now.*production router",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      PLAYWRIGHT_CHROMIUM_EXECUTABLE: executable,
    },
    stdio: "inherit",
  },
);

if (result.error) throw result.error;
process.exit(result.status ?? 1);
