/**
 * Generated-asset pipeline integration tests.
 *
 * Covers:
 *   VAL-CROSS-011 - stale-output-free root and submodule builds produce the
 *                   interpreter and separate NodeDef artefacts served by the
 *                   application; checksums link built and served bytes, ABI
 *                   versions match, src-useq is clean and committed, the root
 *                   gitlink exactly matches that submodule HEAD, and the
 *                   tracked-versus-ignored asset policy is respected.
 *   VAL-DSP-015   - the osc/sine NodeDef module is built separately from the
 *                   ModuLisp interpreter, loaded through the root asset
 *                   pipeline, and its import/export table proves it is a
 *                   distinct artefact (not linked into the interpreter).
 *
 * The browser-side evidence (asset URLs and loads under COEP, telemetry ABI
 * versions) is produced by the objective first-sound browser-flow validator.
 * This file owns the programmatic, terminal-evidence half of the contract.
 *
 * Preconditions intentionally not re-asserted here:
 *   - The interpreter and NodeDef build targets pass their own conformance
 *     suites (those run separately in `src-useq/scripts/test.sh` and
 *     `inspect_osc_sine_wasm.sh`).
 *   - The served bytes were produced by a stale-output-free build. The
 *     checksum equality between src-useq/wasm/* and public/wasm/* is exactly
 *     that proof: any stale output diverges and fails the assertion.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { SYNTH_ARTIFACT_ABI_VERSION } from "./runtimeTypes";

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const SUBMODULE = path.join(REPO_ROOT, "src-useq");
const PUBLIC_WASM = path.join(REPO_ROOT, "public", "wasm");
const SUBMODULE_WASM = path.join(SUBMODULE, "wasm");

/** Read a file as a Buffer (used for checksum comparisons). */
function readFileBytes(absPath: string): Buffer {
  return readFileSync(absPath);
}

/** SHA-256 hex digest of the file at the given absolute path. */
function sha256(absPath: string): string {
  const h = createHash("sha256");
  h.update(readFileBytes(absPath));
  return h.digest("hex");
}

/** Run git in a given cwd and return trimmed stdout. */
function git(args: string[], cwd: string = REPO_ROOT): string {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

/** Read a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relativePath), "utf8");
}

// ---------------------------------------------------------------------------
// VAL-CROSS-011: built/copy artefacts exist on both sides of the pipeline
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: generated asset pipeline produces every served artefact", () => {
  it("interpreter bundle is built in src-useq and copied to public/wasm", () => {
    const builtJs = path.join(SUBMODULE_WASM, "useq.js");
    const builtWasm = path.join(SUBMODULE_WASM, "useq.wasm");
    const servedJs = path.join(PUBLIC_WASM, "useq.js");
    const servedWasm = path.join(PUBLIC_WASM, "useq.wasm");

    for (const p of [builtJs, builtWasm, servedJs, servedWasm]) {
      expect(existsSync(p), `${p} should exist`).toBe(true);
    }
  });

  it("osc/sine NodeDef WASM is built separately and copied to public/wasm", () => {
    const builtNodedef = path.join(SUBMODULE_WASM, "osc_sine.wasm");
    const servedNodedef = path.join(PUBLIC_WASM, "osc_sine.wasm");

    expect(existsSync(builtNodedef), `${builtNodedef} should exist`).toBe(true);
    expect(existsSync(servedNodedef), `${servedNodedef} should exist`).toBe(true);
  });

  it("synthesis AudioWorklet processor bundle is emitted at public/wasm/synthesisWorklet.js", () => {
    const servedWorklet = path.join(PUBLIC_WASM, "synthesisWorklet.js");
    expect(existsSync(servedWorklet), `${servedWorklet} should exist`).toBe(true);

    // The worklet is bundled from a TS source under src/audio, not a copy
    // of a submodule artefact. It must be a non-trivial bundle that calls
    // registerProcessor as a side effect (AudioWorkletGlobalScope contract).
    const workletSource = readFileSync(servedWorklet, "utf8");
    expect(workletSource.length).toBeGreaterThan(1024);
    expect(workletSource).toContain("registerProcessor");
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-011: checksum provenance from build output through served bytes
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: checksums link built and served bytes", () => {
  it("interpreter useq.js built bytes === served bytes (no stale output)", () => {
    const built = path.join(SUBMODULE_WASM, "useq.js");
    const served = path.join(PUBLIC_WASM, "useq.js");
    expect(sha256(built)).toBe(sha256(served));
  });

  it("interpreter useq.wasm built bytes === served bytes (no stale output)", () => {
    const built = path.join(SUBMODULE_WASM, "useq.wasm");
    const served = path.join(PUBLIC_WASM, "useq.wasm");
    expect(sha256(built)).toBe(sha256(served));
  });

  it("osc/sine NodeDef WASM built bytes === served bytes (no stale output)", () => {
    const built = path.join(SUBMODULE_WASM, "osc_sine.wasm");
    const served = path.join(PUBLIC_WASM, "osc_sine.wasm");
    expect(sha256(built)).toBe(sha256(served));
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-011: src-useq is clean, committed, and the root gitlink matches
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: submodule pin coherence", () => {
  it("src-useq working tree is clean (no uncommitted build inputs)", () => {
    const status = git(["status", "--short"], SUBMODULE);
    expect(status, "src-useq working tree must be clean").toBe("");
  });

  it("root gitlink exactly matches src-useq HEAD", () => {
    // `git ls-tree HEAD src-useq` prints `160000 commit <sha>\tsrc-useq`.
    const ls = git(["ls-tree", "HEAD", "src-useq"]);
    const m = ls.match(/^160000 commit ([0-9a-f]{40})\s+src-useq$/);
    expect(m, `unexpected ls-tree output: ${ls}`).not.toBeNull();
    const gitlink = m![1];

    const submoduleHead = git(["rev-parse", "HEAD"], SUBMODULE);
    expect(gitlink).toBe(submoduleHead);
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-011: tracked-versus-ignored asset policy
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: generated-asset policy is declared and respected", () => {
  it("root .gitignore excludes generated public/ artefacts", () => {
    const gitignore = readRepoFile(".gitignore");
    // Generated build output directories and the copied WASM artefacts.
    expect(gitignore).toMatch(/^public\/assets$/m);
    expect(gitignore).toMatch(/^public\/wasm$/m);
    expect(gitignore).toMatch(/^public\/solid-dist$/m);
  });

  it("src-useq .gitignore excludes interpreter and NodeDef WASM outputs", () => {
    const sub = readFileSync(path.join(SUBMODULE_WASM, ".gitignore"), "utf8");
    expect(sub).toMatch(/^useq\.js$/m);
    expect(sub).toMatch(/^useq\.wasm$/m);
    expect(sub).toMatch(/^osc_sine\.wasm$/m);
    expect(sub).toMatch(/^osc_sine\.wat$/m);
  });

  it("no generated WASM artefact is tracked by git", () => {
    // A clean working tree plus the .gitignore rules above guarantees
    // none of the built artefacts can accidentally be committed. We
    // additionally assert `git check-ignore` reports each generated path
    // so a future rule edit cannot silently promote a binary into the
    // tracked set.
    //
    // Submodule paths must be checked in the submodule's own git context
    // because the root working tree reports `fatal: Pathspec ... is in
    // submodule 'src-useq'` rather than resolving the ignore rule. This
    // subtlety is exactly what an integration test must catch.
    const rootPaths = [
      "public/wasm/useq.js",
      "public/wasm/useq.wasm",
      "public/wasm/osc_sine.wasm",
      "public/wasm/synthesisWorklet.js",
    ];
    const submodulePaths = [
      "wasm/useq.js",
      "wasm/useq.wasm",
      "wasm/osc_sine.wasm",
    ];
    const checkIgnored = (rel: string, cwd: string): boolean => {
      try {
        execFileSync("git", ["check-ignore", rel], {
          cwd,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
        return true;
      } catch {
        return false;
      }
    };
    for (const rel of rootPaths) {
      expect(checkIgnored(rel, REPO_ROOT), `${rel} must be git-ignored`).toBe(true);
    }
    for (const rel of submodulePaths) {
      expect(
        checkIgnored(rel, SUBMODULE),
        `src-useq/${rel} must be git-ignored in the submodule`,
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-011 / VAL-COMP-017: interpreter WASM exposes the versioned synth ABI
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: interpreter WASM exposes the synth artefact ABI", () => {
  it("build_wasm.sh lists useq_synth_artifacts in EXPORTED_FUNCTIONS", () => {
    const buildScript = readFileSync(
      path.join(SUBMODULE, "scripts", "build_wasm.sh"),
      "utf8",
    );
    // The script embeds EXPORTED_FUNCTIONS as a JSON array literal inside
    // a shell string, so each symbol appears as `\"_name\"`.
    expect(buildScript).toContain('\\"_useq_synth_artifacts\\"');
  });

  it("rebuilt interpreter WASM is non-empty and within the documented ceiling", () => {
    const wasm = path.join(SUBMODULE_WASM, "useq.wasm");
    const size = statSync(wasm).size;
    expect(size).toBeGreaterThan(100_000);
    // Keep in lockstep with src/runtime/wasmResourceSafety.test.ts: the
    // RP2040 code-size ceiling. Growing past it requires review.
    expect(size).toBeLessThan(360 * 1024);
  });
});

// ---------------------------------------------------------------------------
// VAL-DSP-015 / VAL-DSP-016: NodeDef is a separate artefact
// ---------------------------------------------------------------------------

describe("VAL-DSP-015: osc/sine NodeDef is a separate build artefact", () => {
  it("NodeDef and interpreter WASM are distinct artefacts (different bytes)", () => {
    const nodedef = path.join(SUBMODULE_WASM, "osc_sine.wasm");
    const interpreter = path.join(SUBMODULE_WASM, "useq.wasm");
    expect(sha256(nodedef)).not.toBe(sha256(interpreter));
  });

  it("NodeDef artefact is bounded (< 64 KB, no accidental interpreter linkage)", () => {
    const nodedef = path.join(SUBMODULE_WASM, "osc_sine.wasm");
    const size = statSync(nodedef).size;
    expect(size).toBeGreaterThan(0);
    // Lockstep with src-useq/scripts/inspect_osc_sine_wasm.sh: a bounded
    // hand-written DSP module is well under 64 KB. Crossing the ceiling
    // would suggest accidental linkage into the interpreter.
    expect(size).toBeLessThan(64 * 1024);
  });

  it("build-assets pipeline copies the NodeDef artefact through public/wasm", () => {
    const buildAssets = readRepoFile("scripts/build-assets.mjs");
    // The asset pipeline must know the NodeDef is a separate artefact and
    // copy it into public/wasm/ alongside the interpreter bundle.
    expect(buildAssets).toContain("osc_sine.wasm");
    expect(buildAssets).toContain("oscSineNodedefFile");
    expect(buildAssets).toContain("copyRequiredArtifact");
    expect(buildAssets).toContain("Required ${label}");
  });

  it("production build generates the interpreter and NodeDef artefacts", () => {
    const packageJson = JSON.parse(readRepoFile("package.json")) as {
      scripts?: Record<string, string>;
    };
    expect(packageJson.scripts?.build).toContain("build:wasm");
    expect(packageJson.scripts?.watch).toContain("build:wasm");
    expect(packageJson.scripts?.["build:wasm"]).toContain(
      "./nodedef/build_osc_sine_wasm.sh",
    );
  });

  it("NodeDef WASM binary contains the osc_sine_compute export", () => {
    // Raw byte scan for the export name inside the binary. We do NOT
    // shell out to wasm-dis here - the binary always embeds export name
    // strings. This complements the deeper wasm-dis inspection in
    // src-useq/scripts/inspect_osc_sine_wasm.sh.
    const nodedef = path.join(SUBMODULE_WASM, "osc_sine.wasm");
    const bytes = readFileBytes(nodedef);
    const name = Buffer.from("osc_sine_compute", "utf8");
    expect(bytes.includes(name), "osc_sine_compute export must be present").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// VAL-CROSS-011 / VAL-COMP-015: SYNTH_ARTIFACT_ABI_VERSION constant is stable
// ---------------------------------------------------------------------------

describe("VAL-CROSS-011: synth artefact ABI version is pinned", () => {
  it("runtime ABI version constant is 1", () => {
    // Pinned to the C++ `sig::SYNTH_ARTIFACT_ABI_VERSION` in
    // src-useq/uSEQ/src/signal_engine/synth_graph.h. The versioned
    // payload is what the rebuilt interpreter WASM returns.
    expect(SYNTH_ARTIFACT_ABI_VERSION).toBe(1);
  });
});
