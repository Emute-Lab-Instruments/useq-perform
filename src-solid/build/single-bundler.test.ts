/**
 * Build Verification Test — Single-Bundler Deduplication
 *
 * Verifies that the Vite single-bundler setup correctly deduplicates shared
 * modules into chunks, so that legacy code (bundle.js) and SolidJS islands
 * (transport-toolbar.js, main-toolbar.js, etc.) import the SAME instance of
 * shared modules at runtime rather than each containing an inlined copy.
 *
 * This prevents the "double-copy" problem that existed in the old dual-bundler
 * setup (esbuild IIFE + Vite ES modules).
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
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js"))
    .sort();
}

/**
 * Extract all chunk imports from a built entry point file.
 * Matches patterns like: from"./chunks/foo.js" or from "./chunks/foo.js"
 */
function extractChunkImports(content: string): string[] {
  const re = /from\s*["']\.\/chunks\/([^"']+)["']/g;
  const chunks = new Set<string>();
  let match;
  while ((match = re.exec(content)) !== null) {
    chunks.add(match[1]);
  }
  return [...chunks].sort();
}

// ---------------------------------------------------------------------------
// Shared module fingerprints: strings that uniquely identify each module's
// implementation code (as opposed to code that merely *uses* the module).
// These are log messages or string literals baked into the source module.
// ---------------------------------------------------------------------------
const SHARED_MODULE_FINGERPRINTS: Record<
  string,
  { fingerprint: string; description: string }
> = {
  serialComms: {
    fingerprint: "failed to forward time update",
    description: "src/io/serialComms.mjs — serial communication module",
  },
  persistentUserSettings: {
    fingerprint: "persistentUserSettings.mjs",
    description:
      "src/utils/persistentUserSettings.mjs — user settings persistence",
  },
  mockTimeGenerator: {
    fingerprint: "tick() called but not running",
    description: "src/io/mockTimeGenerator.mjs — mock time generator",
  },
};

// Entry points that are known to transitively depend on shared modules.
// If both bundle.js and at least one island entry import code from the same
// chunk, the module is shared (not duplicated).
const ENTRY_POINTS = [
  "bundle.js",
  "transport-toolbar.js",
  "main-toolbar.js",
  "settings-panel.js",
  "help-panel.js",
  "console-panel.js",
];

describe("Single-bundler deduplication", () => {
  let entryFiles: string[];
  let chunkFiles: string[];

  beforeAll(() => {
    // Verify build output exists
    expect(
      fs.existsSync(BUILD_DIR),
      `Build output directory not found at ${BUILD_DIR}. Run "npm run build" first.`,
    ).toBe(true);
    expect(
      fs.existsSync(CHUNKS_DIR),
      `Chunks directory not found at ${CHUNKS_DIR}. Run "npm run build" first.`,
    ).toBe(true);

    entryFiles = listJsFiles(BUILD_DIR);
    chunkFiles = listJsFiles(CHUNKS_DIR);
  });

  // -----------------------------------------------------------------------
  // 1. Shared modules live in chunks, not inlined into entry points
  // -----------------------------------------------------------------------
  describe("shared modules are extracted into chunks", () => {
    for (const [moduleName, { fingerprint, description }] of Object.entries(
      SHARED_MODULE_FINGERPRINTS,
    )) {
      it(`${moduleName} implementation exists in exactly one chunk (${description})`, () => {
        const chunksContainingModule = chunkFiles.filter((chunkFile) => {
          const content = readBuildFile(`chunks/${chunkFile}`);
          return content.includes(fingerprint);
        });

        expect(
          chunksContainingModule.length,
          `Expected ${moduleName} (fingerprint: "${fingerprint}") to appear in exactly one chunk, ` +
            `but found it in ${chunksContainingModule.length}: [${chunksContainingModule.join(", ")}]`,
        ).toBe(1);
      });

      it(`${moduleName} implementation is NOT inlined into any entry point`, () => {
        const entryPointsContainingModule = entryFiles.filter((entryFile) => {
          const content = readBuildFile(entryFile);
          return content.includes(fingerprint);
        });

        expect(
          entryPointsContainingModule,
          `Expected ${moduleName} (fingerprint: "${fingerprint}") to not be inlined ` +
            `into any entry point, but found it in: [${entryPointsContainingModule.join(", ")}]`,
        ).toEqual([]);
      });
    }
  });

  // -----------------------------------------------------------------------
  // 2. Multiple entry points reference the SAME chunk for shared modules
  // -----------------------------------------------------------------------
  describe("entry points share chunks instead of duplicating code", () => {
    it("bundle.js and transport-toolbar.js import from the same visualisationController chunk", () => {
      const bundleImports = extractChunkImports(readBuildFile("bundle.js"));
      const transportImports = extractChunkImports(
        readBuildFile("transport-toolbar.js"),
      );

      const sharedChunk = "visualisationController.js";
      expect(
        bundleImports,
        "bundle.js should import from visualisationController chunk",
      ).toContain(sharedChunk);
      expect(
        transportImports,
        "transport-toolbar.js should import from visualisationController chunk",
      ).toContain(sharedChunk);
    });

    it("bundle.js and transport-toolbar.js import from the same mockTimeGenerator chunk", () => {
      const bundleImports = extractChunkImports(readBuildFile("bundle.js"));
      const transportImports = extractChunkImports(
        readBuildFile("transport-toolbar.js"),
      );

      const sharedChunk = "mockTimeGenerator.js";
      expect(
        bundleImports,
        "bundle.js should import from mockTimeGenerator chunk",
      ).toContain(sharedChunk);
      expect(
        transportImports,
        "transport-toolbar.js should import from mockTimeGenerator chunk",
      ).toContain(sharedChunk);
    });

    it("bundle.js and main-toolbar.js import from the same visualisationController chunk", () => {
      const bundleImports = extractChunkImports(readBuildFile("bundle.js"));
      const toolbarImports = extractChunkImports(
        readBuildFile("main-toolbar.js"),
      );

      const sharedChunk = "visualisationController.js";
      expect(
        bundleImports,
        "bundle.js should import from visualisationController chunk",
      ).toContain(sharedChunk);
      expect(
        toolbarImports,
        "main-toolbar.js should import from visualisationController chunk",
      ).toContain(sharedChunk);
    });

    it("at least two entry points share each chunk that contains a shared module", () => {
      // Build a map: chunk → list of entry points that import it
      const chunkConsumers: Record<string, string[]> = {};
      for (const entryFile of entryFiles) {
        const imports = extractChunkImports(readBuildFile(entryFile));
        for (const chunk of imports) {
          if (!chunkConsumers[chunk]) chunkConsumers[chunk] = [];
          chunkConsumers[chunk].push(entryFile);
        }
      }

      // For each shared module, find which chunk it lives in and verify
      // that chunk is imported by at least 2 entry points
      for (const [moduleName, { fingerprint }] of Object.entries(
        SHARED_MODULE_FINGERPRINTS,
      )) {
        const hostChunk = chunkFiles.find((chunkFile) => {
          const content = readBuildFile(`chunks/${chunkFile}`);
          return content.includes(fingerprint);
        });

        expect(
          hostChunk,
          `Could not find chunk containing ${moduleName}`,
        ).toBeDefined();

        const consumers = chunkConsumers[hostChunk!] || [];
        expect(
          consumers.length,
          `Chunk ${hostChunk} (hosting ${moduleName}) should be imported by ` +
            `at least 2 entry points, but is only imported by: [${consumers.join(", ")}]`,
        ).toBeGreaterThanOrEqual(2);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 3. No module code is duplicated across entry points
  // -----------------------------------------------------------------------
  describe("no shared module code duplicated across entry points", () => {
    it("no fingerprint string appears in more than one entry point", () => {
      for (const [moduleName, { fingerprint }] of Object.entries(
        SHARED_MODULE_FINGERPRINTS,
      )) {
        const entryPointsWithFingerprint = entryFiles.filter((entryFile) => {
          const content = readBuildFile(entryFile);
          return content.includes(fingerprint);
        });

        expect(
          entryPointsWithFingerprint.length,
          `Shared module ${moduleName} (fingerprint: "${fingerprint}") is inlined in ` +
            `entry points: [${entryPointsWithFingerprint.join(", ")}]. ` +
            `It should only exist in a chunk.`,
        ).toBe(0);
      }
    });

    it("no fingerprint string appears in more than one chunk", () => {
      for (const [moduleName, { fingerprint }] of Object.entries(
        SHARED_MODULE_FINGERPRINTS,
      )) {
        const chunksWithFingerprint = chunkFiles.filter((chunkFile) => {
          const content = readBuildFile(`chunks/${chunkFile}`);
          return content.includes(fingerprint);
        });

        expect(
          chunksWithFingerprint.length,
          `Shared module ${moduleName} (fingerprint: "${fingerprint}") appears in ` +
            `multiple chunks: [${chunksWithFingerprint.join(", ")}]. ` +
            `It should be in exactly one chunk.`,
        ).toBe(1);
      }
    });
  });

  // -----------------------------------------------------------------------
  // 4. Structural check: entry points use ES module imports (not inlined)
  // -----------------------------------------------------------------------
  describe("entry points use ES module chunk imports", () => {
    it("every entry point imports from at least one chunk", () => {
      for (const entryFile of ENTRY_POINTS) {
        if (!fs.existsSync(path.join(BUILD_DIR, entryFile))) continue;

        const content = readBuildFile(entryFile);
        const imports = extractChunkImports(content);

        expect(
          imports.length,
          `Entry point ${entryFile} should import from at least one chunk ` +
            `(indicating code splitting is active)`,
        ).toBeGreaterThan(0);
      }
    });

    it("chunks directory contains shared code files", () => {
      expect(
        chunkFiles.length,
        "Expected chunks directory to contain shared code files",
      ).toBeGreaterThan(0);
    });
  });
});
