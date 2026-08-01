/**
 * Generated-asset pipeline integration tests.
 *
 * Covers:
 *   VAL-CROSS-011 - stale-output-free root and submodule builds produce the
 *                   interpreter and separate NodeDef artefacts served by the
 *                   application; the compiler capability manifest binds the
 *                   exact built and served interpreter bytes to the pinned
 *                   clean compiler commit; ABI versions match; and the
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
 *   - The NodeDef remains a separate provenance domain. Its source/build
 *     authenticity is not asserted by the compiler capability manifest.
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

interface CompilerCapabilityManifest {
  readonly schema: string;
  readonly source: {
    readonly git_commit: string;
    readonly git_dirty: boolean;
    readonly git_dirty_entries: readonly string[];
  };
  readonly artifacts: Readonly<Record<string, {
    readonly bytes: number;
    readonly sha256: string;
  }>>;
  readonly capabilities: {
    readonly hard_limits: {
      readonly synth_artifact_abi_version: number;
    };
    readonly public_function_exports?: readonly string[];
  };
}

function compilerManifest(base: string): CompilerCapabilityManifest {
  return JSON.parse(readFileSync(
    path.join(base, "useq-capabilities.json"),
    "utf8",
  )) as CompilerCapabilityManifest;
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

    const builtManifest = path.join(SUBMODULE_WASM, "useq-capabilities.json");
    const servedManifest = path.join(PUBLIC_WASM, "useq-capabilities.json");

    for (const p of [
      builtJs,
      builtWasm,
      builtManifest,
      servedJs,
      servedWasm,
      servedManifest,
    ]) {
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
  it("compiler capability manifest built bytes === served bytes", () => {
    const built = path.join(SUBMODULE_WASM, "useq-capabilities.json");
    const served = path.join(PUBLIC_WASM, "useq-capabilities.json");
    expect(sha256(built)).toBe(sha256(served));
  });

  it("compiler manifest binds exact built and served JS/WASM bytes", () => {
    const builtManifest = compilerManifest(SUBMODULE_WASM);
    const servedManifest = compilerManifest(PUBLIC_WASM);
    expect(servedManifest).toEqual(builtManifest);
    expect(builtManifest.schema).toBe("useq.compiler-capabilities/v1");
    expect(
      builtManifest.capabilities.hard_limits.synth_artifact_abi_version,
    ).toBe(SYNTH_ARTIFACT_ABI_VERSION);

    for (const [key, filename] of [
      ["wasm/useq.js", "useq.js"],
      ["wasm/useq.wasm", "useq.wasm"],
    ] as const) {
      const record = builtManifest.artifacts[key];
      expect(record, `${key} must be attested`).toBeDefined();
      for (const base of [SUBMODULE_WASM, PUBLIC_WASM]) {
        const file = path.join(base, filename);
        expect(statSync(file).size).toBe(record.bytes);
        expect(sha256(file)).toBe(record.sha256);
      }
    }
  });

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

  it("compiler manifest names the exact clean gitlink commit", () => {
    const manifest = compilerManifest(PUBLIC_WASM);
    const submoduleHead = git(["rev-parse", "HEAD"], SUBMODULE);
    expect(manifest.source.git_commit).toBe(submoduleHead);
    expect(manifest.source.git_dirty).toBe(false);
    expect(manifest.source.git_dirty_entries).toEqual([]);
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
    expect(sub).toMatch(/^useq-capabilities\.json$/m);
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
      "public/wasm/useq-capabilities.json",
      "public/wasm/osc_sine.wasm",
      "public/wasm/synthesisWorklet.js",
    ];
    const submodulePaths = [
      "wasm/useq.js",
      "wasm/useq.wasm",
      "wasm/useq-capabilities.json",
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
  it("tracked build profile and generated manifest export the synth ABI", () => {
    const profile = JSON.parse(readFileSync(
      path.join(SUBMODULE, "scripts", "wasm_build_profile.json"),
      "utf8",
    )) as { public_function_exports?: readonly string[] };
    const manifest = compilerManifest(PUBLIC_WASM);
    expect(profile.public_function_exports).toContain("useq_synth_artifacts");
    expect(profile.public_function_exports).toContain("useq_tick_synth_controls");
    expect(manifest.capabilities.public_function_exports)
      .toEqual(profile.public_function_exports);
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
  it("compiler capability manifest makes no NodeDef provenance claim", () => {
    const manifest = compilerManifest(PUBLIC_WASM);
    expect(manifest.artifacts["wasm/osc_sine.wasm"]).toBeUndefined();
  });

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
  it("runtime ABI version constant is 2", () => {
    // Pinned to the C++ `sig::SYNTH_ARTIFACT_ABI_VERSION` in
    // src-useq/uSEQ/src/signal_engine/synth_graph.h. The versioned
    // payload is what the rebuilt interpreter WASM returns.
    expect(SYNTH_ARTIFACT_ABI_VERSION).toBe(2);
  });
});
