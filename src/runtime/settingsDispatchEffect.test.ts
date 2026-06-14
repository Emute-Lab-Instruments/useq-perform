// Regression test for CF8: the wasm-enabled runtime-session side effect used to
// live in appSettingsRepository.dispatchSettingsChanged(), which imported
// runtimeService, which re-exported from runtimeSessionService, which imported
// back from appSettingsRepository — a module cycle. The effect now lives in
// runtimeSettingsService (service → repository, one-directional).
//
// These tests pin the load-bearing behaviour the refactor had to preserve:
// mutating settings through the service propagates wasm.enabled into the
// runtime session. They use the REAL modules (no mocks) so a broken hook wiring
// would fail here.
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// Repo root derived from THIS file's location (src/runtime/ → repo root),
// not process.cwd() — under vitest the cwd can be a different worktree that
// shares node_modules, which would make madge analyse the wrong tree.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

import {
  updateSettings,
  resetSettings,
  isRuntimeWasmEnabled,
  resetRuntimeServiceForTests,
} from "./runtimeService";

describe("settings dispatch → runtime-session effect (CF8)", () => {
  beforeEach(() => {
    resetRuntimeServiceForTests();
  });

  afterEach(() => {
    // Restore the wasm section to its default so other suites start clean.
    resetSettings("wasm");
    resetRuntimeServiceForTests();
  });

  it("propagates wasm.enabled into the runtime session on updateSettings", () => {
    updateSettings({ wasm: { enabled: false } });
    expect(isRuntimeWasmEnabled()).toBe(false);

    updateSettings({ wasm: { enabled: true } });
    expect(isRuntimeWasmEnabled()).toBe(true);
  });

  it("propagates wasm.enabled when a section is reset", () => {
    updateSettings({ wasm: { enabled: false } });
    expect(isRuntimeWasmEnabled()).toBe(false);

    // Resetting the wasm section restores the default (enabled) and must
    // also dispatch the runtime-session effect.
    resetSettings("wasm");
    expect(isRuntimeWasmEnabled()).toBe(true);
  });
});

describe("module-graph (CF8)", () => {
  it("has no appSettingsRepository → runtimeService → runtimeSessionService back-edge", () => {
    // madge is a devDependency; run it as a no-cycle assertion for the
    // specific CF8 back-edge this fix removed. madge exits non-zero whenever
    // ANY circular dep exists (the codebase still has unrelated ones), so we
    // capture stdout regardless of exit code and assert only on our edge.
    let output = "";
    try {
      output = execFileSync(
        "npx",
        [
          "madge",
          "--circular",
          "--extensions",
          "ts,tsx",
          "src/runtime/appSettingsRepository.ts",
        ],
        { cwd: REPO_ROOT, encoding: "utf8" },
      );
    } catch (error) {
      output = String((error as { stdout?: unknown }).stdout ?? "");
    }

    expect(output).not.toMatch(
      /appSettingsRepository\.ts > runtimeService\.ts > runtimeSessionService\.ts/,
    );
  });
});
