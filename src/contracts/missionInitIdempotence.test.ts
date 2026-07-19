/**
 * Mission-init idempotence and service-free contract tests.
 *
 * Covers:
 *   VAL-CROSS-015 - running mission `init.sh` twice verifies required
 *                   dependencies, regenerates missing or stale ignored
 *                   interpreter inputs when needed, and starts no
 *                   long-running service or listener.
 *
 * The mission init.sh lives at:
 *   /home/w1n5t0n/.factory/missions/bd55f750-96dc-4529-9427-6f22c5714013/init.sh
 *
 * Evidence captured:
 *   - first and second run exit 0;
 *   - no long-running service is started (port 5000 stays free unless
 *     a previous test session is already using it; we record the
 *     listener count before and after each run);
 *   - the second run is a no-op rebuild when the inputs are unchanged
 *     (the WASM artefacts are NOT rewritten, i.e. the ctime/mtime is
 *     preserved across the second run).
 *
 * This test does NOT delete generated ignored inputs. It relies on the
 * mission's existing stale-output-free build state established by
 * previous workers. The idempotence contract is that two consecutive
 * runs land at the same dependency + generated-input + port state.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const MISSION_DIR = "/home/w1n5t0n/.factory/missions/bd55f750-96dc-4529-9427-6f22c5714013";
const INIT_SH = resolve(MISSION_DIR, "init.sh");
const REPO_ROOT = resolve(__dirname, "..", "..");
const SUBMODULE = resolve(REPO_ROOT, "src-useq");
const INTERPRETER_WASM = resolve(SUBMODULE, "wasm/useq.wasm");
const NODEDEF_WASM = resolve(SUBMODULE, "wasm/osc_sine.wasm");

/** Run init.sh and capture combined output; throws on non-zero exit. */
function runInit(): string {
  return execFileSync("bash", [INIT_SH], {
    cwd: MISSION_DIR,
    encoding: "utf8",
    stdio: "pipe",
    timeout: 600_000,
    env: {
      ...process.env,
      // Keep the agent-browser Chromium path stable.
      PATH: process.env.PATH ?? "",
    },
  });
}

/**
 * Return the set of TCP listeners on port 5000 as a stable signature.
 * We use `ss -ltn` (available on Linux without root). If `ss` is not
 * available, this function returns the empty string; the test then
 * falls back to counting processes named `serve` (the static server).
 */
function port5000ListenerSignature(): string {
  try {
    const out = execFileSync("ss", ["-ltn"], {
      encoding: "utf8",
      stdio: "pipe",
      timeout: 5_000,
    });
    return out
      .split("\n")
      .filter((line) => line.includes(":5000"))
      .join("\n");
  } catch {
    return "";
  }
}

/**
 * Return a stable signature of `serve`-like processes that may have been
 * started by `npm run start`. Used as a fallback when `ss` is unavailable.
 */
function serveProcessCount(): number {
  try {
    const out = execFileSync(
      "pgrep",
      ["-f", "serve public -p 5000"],
      { encoding: "utf8", stdio: "pipe", timeout: 5_000 },
    );
    return out.split("\n").filter(Boolean).length;
  } catch {
    // pgrep exits 1 when no match; treat that as zero processes.
    return 0;
  }
}

describe("mission init.sh idempotence and service-free (VAL-CROSS-015)", () => {
  it("the init.sh script exists at the mission path", () => {
    expect(existsSync(INIT_SH)).toBe(true);
  });

  it("runs init.sh once successfully and verifies toolchain inputs", () => {
    const out = runInit();
    // Toolchain verification: init.sh ends by printing version strings
    // for every checked binary. Match the actual output shape: node
    // prints `v<version>` (e.g. `v25.4.0`), npm prints bare semver, etc.
    // `ergo help` is invoked with stdout redirected to /dev/null in
    // init.sh, so its output is intentionally absent — the exit-0 path
    // through `runInit` is the ergo verification.
    expect(out).toMatch(/\bv\d+\.\d+\.\d+\b/); // node --version
    expect(out).toMatch(/\b\d+\.\d+\.\d+\b/); // npm --version
    expect(out).toMatch(/\d+\.\d+\.\d+/); // meson / ninja
    expect(out).toMatch(/emcc/i);
    expect(out).toMatch(/agent-browser/i);
    expect(out).toMatch(/wasm-dis/i);
  });

  it("leaves the required ignored interpreter inputs present after the first run", () => {
    expect(existsSync(INTERPRETER_WASM)).toBe(true);
  });

  it("leaves the required NodeDef WASM artefact present after the first run", () => {
    expect(existsSync(NODEDEF_WASM)).toBe(true);
  });

  it("is idempotent: a second run exits successfully and rewrites no input when sources are unchanged", () => {
    // Capture mtime/size of the generated ignored inputs before the
    // second run. With no source change, the second run's staleness
    // check must detect a fresh state and skip the rebuild.
    const beforeInterpreter = statSync(INTERPRETER_WASM);
    const beforeNodedef = existsSync(NODEDEF_WASM)
      ? statSync(NODEDEF_WASM)
      : null;

    const out = runInit();

    const afterInterpreter = statSync(INTERPRETER_WASM);
    const afterNodedef = existsSync(NODEDEF_WASM)
      ? statSync(NODEDEF_WASM)
      : null;

    // Both runs exit 0 (execFileSync throws otherwise); verify the
    // second run reached the toolchain verification tail.
    expect(out).toMatch(/emcc/i);

    // Idempotence: with no source change, neither ignored generated
    // artefact is rewritten.
    expect(afterInterpreter.mtimeMs).toBe(beforeInterpreter.mtimeMs);
    expect(afterInterpreter.size).toBe(beforeInterpreter.size);
    if (beforeNodedef !== null && afterNodedef !== null) {
      expect(afterNodedef.mtimeMs).toBe(beforeNodedef.mtimeMs);
      expect(afterNodedef.size).toBe(beforeNodedef.size);
    }
  });

  it("starts no long-running service: port 5000 and serve-process state are unchanged by init.sh", () => {
    const beforePort = port5000ListenerSignature();
    const beforeServe = serveProcessCount();

    runInit();

    const afterPort = port5000ListenerSignature();
    const afterServe = serveProcessCount();

    // The listener signature must be unchanged. If `ss` was unavailable
    // (both signatures are empty), fall back to the serve-process count.
    if (beforePort !== "" || afterPort !== "") {
      expect(afterPort).toBe(beforePort);
    } else {
      expect(afterServe).toBe(beforeServe);
    }
  });

  it("does not launch a service (init must be service-free by design)", () => {
    // Read the script text and assert there is no service-start primitive.
    // The mission's web service start in services.yaml DOES use setsid+env
    // and `serve public -p 5000` to launch a background listener; init.sh
    // must not. `setsid` is permitted only as a binary existence check in
    // the toolchain verification loop, never as a launch prefix.
    const initText = readFileSync(INIT_SH, "utf8");
    // A launch uses setsid followed by an env/serve invocation. The bare
    // `setsid` token inside `for command in ... setsid ...` is allowed.
    expect(initText).not.toMatch(/setsid\s+env/);
    expect(initText).not.toMatch(/setsid\s+.*PORT=5000/);
    // init.sh must not start the static server, dev server, or preview
    // server. The strings appear only in the `for command in` toolchain
    // existence check loop (where `serve` is not listed), not here.
    expect(initText).not.toMatch(/npm run (start|dev|preview)\b/);
    expect(initText).not.toMatch(/serve\s+public/);
    expect(initText).not.toMatch(/PORT=5000/);
  });
});
