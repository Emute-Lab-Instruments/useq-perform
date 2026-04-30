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
