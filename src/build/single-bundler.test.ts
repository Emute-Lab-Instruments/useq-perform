/**
 * Build Verification Test — Single-Bundle Architecture
 *
 * Verifies that the Vite single-bundle setup produces a working build output.
 * After eliminating islands, we now have a single bundle.js entry point
 * that includes all UI components via adapters.
 *
 * Previous tests checked for deduplication across multiple entry points.
 * With the island elimination, those tests are no longer applicable.
 */
import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

const BUILD_DIR = path.resolve(__dirname, "../../public/solid-dist");
const CHUNKS_DIR = path.join(BUILD_DIR, "chunks");

/** Read a file from the build output directory. */
function readBuildFile(relativePath: string): string {
  return fs.readFileSync(path.join(BUILD_DIR, relativePath), "utf-8");
}

/** List all .js files directly in a directory. */
function listJsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

// Entry point for the application (single bundle after island elimination)
const ENTRY_POINT = "bundle.js";

// Shared modules that should be present in the build
const EXPECTED_MODULES = [
  { fingerprint: "serialComms", description: "serial communication module" },
  { fingerprint: "appSettingsRepository", description: "user settings persistence" },
];

describe("Single-bundle build structure", () => {
  let entryFiles: string[];
  let chunkFiles: string[];

  beforeAll(() => {
    // Verify build output exists
    expect(
      fs.existsSync(BUILD_DIR),
      `Build output directory not found at ${BUILD_DIR}. Run "npm run build" first.`,
    ).toBe(true);

    entryFiles = listJsFiles(BUILD_DIR);
    chunkFiles = listJsFiles(CHUNKS_DIR);
  });

  // -----------------------------------------------------------------------
  // 1. Core bundle structure
  // -----------------------------------------------------------------------
  describe("core bundle structure", () => {
    it("bundle.js entry point exists", () => {
      expect(
        entryFiles,
        `Expected bundle.js to exist in ${BUILD_DIR}`,
      ).toContain(ENTRY_POINT);
    });

    it("bundle.css exists", () => {
      const cssFile = path.join(BUILD_DIR, "bundle.css");
      expect(
        fs.existsSync(cssFile),
        `Expected bundle.css to exist in ${BUILD_DIR}`,
      ).toBe(true);
    });

    it("bundle.js is non-empty", () => {
      const content = readBuildFile(ENTRY_POINT);
      expect(
        content.length,
        "bundle.js should contain compiled code",
      ).toBeGreaterThan(1000);
    });
  });

  // -----------------------------------------------------------------------
  // 2. Chunks directory structure
  // -----------------------------------------------------------------------
  describe("chunks directory structure", () => {
    it("chunks directory exists (may be empty or contain shared code)", () => {
      // Note: chunks directory may be empty if everything is bundled together
      expect(
        fs.existsSync(CHUNKS_DIR),
        `Expected chunks directory to exist at ${CHUNKS_DIR}`,
      ).toBe(true);
    });

    it("chunks directory contains .js files or is empty", () => {
      // This is informational - we allow empty chunks if everything is in bundle.js
      if (chunkFiles.length > 0) {
        expect(chunkFiles.every(f => f.endsWith('.js'))).toBe(true);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. Key modules are present in the build
  // -----------------------------------------------------------------------
  describe("key modules present in build", () => {
    it("serial communication code is included in the bundle", () => {
      const content = readBuildFile(ENTRY_POINT);
      // Check for any evidence of serial comms module
      const hasSerialComms = content.includes("serial") ||
                              content.includes("Serial") ||
                              content.includes("Comms");
      expect(
        hasSerialComms,
        "Expected serial communication code in bundle",
      ).toBe(true);
    });

    it("settings code is included in the bundle", () => {
      const content = readBuildFile(ENTRY_POINT);
      // Check for evidence of settings panel
      const hasSettings = content.includes("Settings") ||
                          content.includes("settings");
      expect(
        hasSettings,
        "Expected settings code in bundle",
      ).toBe(true);
    });

    it("adapter code is included in the bundle", () => {
      const content = readBuildFile(ENTRY_POINT);
      // Check for evidence of adapters
      const hasAdapters = content.includes("mountModal") ||
                          content.includes("mountPickerMenu") ||
                          content.includes("mountSettingsPanel");
      expect(
        hasAdapters,
        "Expected adapter mounting functions in bundle",
      ).toBe(true);
    });
  });

  // -----------------------------------------------------------------------
  // 4. No island entry points (islands eliminated)
  // -----------------------------------------------------------------------
  describe("no island entry points", () => {
    const ISLAND_FILES = [
      "test-island.js",
      "double-radial-menu.js",
      "transport-toolbar.js",
      "main-toolbar.js",
      "settings-panel.js",
      "help-panel.js",
      "console-panel.js",
      "picker-menu.js",
      "modal.js",
      "snippets-panel.js",
    ];

    for (const islandFile of ISLAND_FILES) {
      it(`${islandFile} does NOT exist (islands eliminated)`, () => {
        expect(
          entryFiles,
          `Island file ${islandFile} should not exist (islands have been eliminated)`,
        ).not.toContain(islandFile);
      });
    }
  });
});
