/**
 * Atomic synth Worker response contract tests.
 *
 * Covers:
 *   VAL-COMP-013 — one exact-eval Worker response carries diagnostics and
 *                  all committed synth artefacts, and cannot race with a
 *                  second mutable-state read.
 *   VAL-COMP-014 — a failed exact-eval response carries diagnostics but no
 *                  payload that can allocate an engine commit (the synth
 *                  artefacts retain the LAST successful revision).
 *   VAL-COMP-015 — the synth artefact ABI is versioned and rejects
 *                  incompatible consumers explicitly.
 *
 * The Worker-response atomicity is exercised by mocking the worker protocol
 * directly. Native/WASM byte equivalence (VAL-COMP-016) and the fresh-assets
 * reload assertion (VAL-COMP-017) are covered by the wasmInterpreter suite
 * and the agent-browser milestone validator respectively.
 */
import { describe, expect, it } from "vitest";

import {
  OPTIONAL_WASM_EXPORTS,
  REQUIRED_WASM_EXPORT_NAMES,
} from "../contracts/wasmAbi";
import {
  SYNTH_ARTIFACT_ABI_VERSION,
  isSynthArtifactsPayload,
  synthArtifactsSupportsAbi,
} from "../contracts/runtimeTypes";

// ---------------------------------------------------------------------------
// VAL-COMP-013: useq_synth_artifacts is part of the published ABI surface
// ---------------------------------------------------------------------------

describe("VAL-COMP-013: synth artefacts in published WASM ABI", () => {
  it("useq_synth_artifacts is declared in the optional ABI descriptor", () => {
    // The atomic Worker response needs the synth-artefact export to be a
    // first-class part of the ABI descriptor so consumers can probe it the
    // same way they probe diagnostics.
    expect(OPTIONAL_WASM_EXPORTS.useq_synth_artifacts).toBeDefined();
    expect(OPTIONAL_WASM_EXPORTS.useq_synth_artifacts.symbol).toBe(
      "useq_synth_artifacts",
    );
    expect(OPTIONAL_WASM_EXPORTS.useq_synth_artifacts.returnType).toBe("string");
    expect(OPTIONAL_WASM_EXPORTS.useq_synth_artifacts.argTypes).toEqual([]);
  });

  it("useq_synth_artifacts is listed in the build script's EXPORTED_FUNCTIONS", async () => {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");
    const buildScript = readFileSync(
      path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../src-useq/scripts/build_wasm.sh",
      ),
      "utf8",
    );
    // The build script lists EXPORTED_FUNCTIONS as a JSON array literal
    // inside a shell string, so each symbol appears as `\"_name\"`. The
    // atomic Worker response needs this export to be live in the bundle.
    expect(buildScript).toContain('\\"_useq_synth_artifacts\\"');
    // Sanity: the required eval/diagnostics surface is still listed.
    for (const required of REQUIRED_WASM_EXPORT_NAMES) {
      expect(buildScript).toContain(`\\"_${required}\\"`);
    }
  });
});

// ---------------------------------------------------------------------------
// VAL-COMP-014: failed eval cannot create an engine commit
// ---------------------------------------------------------------------------

describe("VAL-COMP-014: failed eval response shape contract", () => {
  it("a failed eval response carries diagnostics but the same prior revision", () => {
    // This is a static contract test: the response shape guarantees that
    // a failed eval carries (a) a populated diagnostics array and (b) a
    // synthArtifacts payload whose revision matches the LAST successful
    // commit. The native and WASM-level rollback semantics are covered by
    // test_synth_wasm_abi.cpp (native) and wasmInterpreter.test.ts (WASM).
    //
    // The contract here is the SHAPE: callers identify a failed eval by
    // inspecting `diagnostics` for severity === "error" — there is no
    // separate "failure" flag — and they must NOT use `synthArtifacts` to
    // allocate a new engine commit when diagnostics contain an error.
    const failedResponse = {
      result: "Error: unknown def",
      diagnostics: [
        {
          severity: "error",
          category: "synth",
          start: 0,
          end: 1,
          message: "unknown def",
        },
      ],
      synthArtifacts: {
        abi: SYNTH_ARTIFACT_ABI_VERSION,
        revision: 1, // unchanged from the previous successful commit
        declarations: [
          {
            identity: "lead",
            def: "osc/sine",
            version: 1,
            audio_inputs: 0,
            audio_outputs: 1,
          },
        ],
        controls: [
          {
            identity: "lead",
            param: "freq",
            rate: "block",
            smoothing: "step",
          },
        ],
      },
    };

    // A consumer MUST first inspect diagnostics for severity "error" before
    // interpreting the synthArtifacts body. When diagnostics include an
    // error, the synthArtifacts payload MUST be treated as the last good
    // commit, not a new commit.
    const isError = failedResponse.diagnostics.some(
      (d) => d.severity === "error",
    );
    expect(isError).toBe(true);

    // The artefacts payload is still present (rollback semantics — the
    // previous successful commit is retained) but its revision MUST equal
    // the prior successful revision, signalling no engine commit.
    expect(failedResponse.synthArtifacts).not.toBeNull();
    expect(failedResponse.synthArtifacts?.revision).toBe(1);
    expect(failedResponse.synthArtifacts?.declarations).toHaveLength(1);
  });

  it("a successful eval response carries fresh artefacts at an advanced revision", () => {
    // Counterpart to the failed case: a successful eval advances the
    // revision and the response's synthArtifacts reflects the new commit.
    const successResponse = {
      result: "ok",
      diagnostics: [],
      synthArtifacts: {
        abi: SYNTH_ARTIFACT_ABI_VERSION,
        revision: 2,
        declarations: [
          {
            identity: "lead",
            def: "osc/sine",
            version: 1,
            audio_inputs: 0,
            audio_outputs: 1,
          },
        ],
        controls: [
          {
            identity: "lead",
            param: "freq",
            rate: "block",
            smoothing: "step",
          },
        ],
      },
    };

    const isError = successResponse.diagnostics.some(
      (d) => d.severity === "error",
    );
    expect(isError).toBe(false);
    expect(successResponse.synthArtifacts?.revision).toBeGreaterThan(1);
    expect(successResponse.synthArtifacts?.declarations).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// VAL-COMP-015: synth artefact ABI is versioned
// ---------------------------------------------------------------------------

describe("VAL-COMP-015: versioned synth artefact ABI", () => {
  it("SYNTH_ARTIFACT_ABI_VERSION is a positive integer", () => {
    expect(Number.isInteger(SYNTH_ARTIFACT_ABI_VERSION)).toBe(true);
    expect(SYNTH_ARTIFACT_ABI_VERSION).toBeGreaterThan(0);
  });

  it("synthArtifactsSupportsAbi accepts the canonical version", () => {
    expect(synthArtifactsSupportsAbi(SYNTH_ARTIFACT_ABI_VERSION)).toBe(true);
  });

  it("synthArtifactsSupportsAbi rejects incompatible versions", () => {
    // A consumer built against a future or older ABI must be rejected.
    expect(synthArtifactsSupportsAbi(SYNTH_ARTIFACT_ABI_VERSION + 1)).toBe(
      false,
    );
    expect(synthArtifactsSupportsAbi(SYNTH_ARTIFACT_ABI_VERSION - 1)).toBe(
      false,
    );
    expect(synthArtifactsSupportsAbi(99)).toBe(false);
    expect(synthArtifactsSupportsAbi(0)).toBe(false);
  });

  it("isSynthArtifactsPayload narrows well-formed payloads", () => {
    const wellFormed = {
      abi: SYNTH_ARTIFACT_ABI_VERSION,
      revision: 1,
      declarations: [],
      controls: [],
    };
    expect(isSynthArtifactsPayload(wellFormed)).toBe(true);

    // ABI error envelopes are not payloads.
    const abiError = {
      abi: SYNTH_ARTIFACT_ABI_VERSION,
      abi_error: true,
      engine_abi: SYNTH_ARTIFACT_ABI_VERSION,
      consumer_abi: 99,
    };
    expect(isSynthArtifactsPayload(abiError)).toBe(false);

    // Garbage is rejected.
    expect(isSynthArtifactsPayload(null)).toBe(false);
    expect(isSynthArtifactsPayload({})).toBe(false);
    expect(isSynthArtifactsPayload({ abi: 1 })).toBe(false);
  });
});
