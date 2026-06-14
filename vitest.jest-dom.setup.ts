/**
 * Setup file whose path contains the substring "jest-dom", which causes
 * vite-plugin-solid's setupFiles auto-injection to skip auto-resolving
 * `@testing-library/jest-dom/vitest` (that auto-resolution path fails inside
 * symlinked git-worktree node_modules layouts on this machine).
 *
 * We still want the matchers, so we register them explicitly here using the
 * matchers entry-point (which avoids the broken auto-resolution path).
 */
import * as matchers from "@testing-library/jest-dom/matchers";
import { expect } from "vitest";

expect.extend(matchers as any);

// jsdom does not implement ResizeObserver. Polyfill with a no-op stub so that
// CodeMirror's ProbePlugin (and any other extension that instantiates a
// ResizeObserver) can initialise without throwing in unit tests.
if (typeof global.ResizeObserver === "undefined") {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// jsdom's Range does not implement getClientRects/getBoundingClientRect.
// CodeMirror's DocView.measureTextSize() calls textRange(...).getClientRects()
// during its rAF-scheduled measure pass; when a test mounts a real EditorView
// the measure fires asynchronously (after the test body) and throws
// "textRange(...).getClientRects is not a function", surfacing as an unhandled
// error that pollutes unrelated test files. Stub both to empty geometry so the
// measure pass is a harmless no-op in unit tests.
if (typeof Range !== "undefined") {
  const emptyRect = () => ({
    x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0,
    toJSON() { return {}; },
  });
  if (typeof Range.prototype.getClientRects !== "function") {
    Range.prototype.getClientRects = function getClientRects() {
      const list: any = [];
      list.item = (i: number) => list[i] ?? null;
      return list as unknown as DOMRectList;
    };
  }
  if (typeof Range.prototype.getBoundingClientRect !== "function") {
    Range.prototype.getBoundingClientRect =
      function getBoundingClientRect() {
        return emptyRect() as DOMRect;
      };
  }
}
