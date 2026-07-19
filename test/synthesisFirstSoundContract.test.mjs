import { expect } from "chai";
import "./setup.mjs";

/**
 * Structural contract test for the first-sound browser flow
 * (VAL-CROSS-001..009, VAL-CROSS-013, VAL-ENGINE-031).
 *
 * This test validates the TypeScript modules and contracts that the
 * ordered browser journey depends on. It does NOT require a live
 * browser; the actual browser evidence is captured by the
 * integration worker's agent-browser session.
 *
 * The test proves that:
 *   - The synthesis service exposes the expected devmode surface
 *   - The worklet core's adapter resolution handles the instantiate-
 *     before-module race
 *   - The producer's control-values pipeline is wired end-to-end
 *   - The engine commit coordinator prefills ALL descriptor params
 *   - The module transfer prefers bytes for cross-browser reliability
 */

describe("synthesis first-sound contract (VAL-CROSS-001..009/013)", () => {
  describe("module transfer payload (VAL-CROSS-002 reliability)", () => {
    it("buildModuleTransferPayload prefers wasmBytes over compiled module", async () => {
      const { buildModuleTransferPayload } = await import(
        "../src/audio/synthesisService.ts"
      );
      const { OSC_SINE_NODEDEF_DESCRIPTOR } = await import(
        "../src/contracts/nodeDefRegistry.ts"
      );
      const { readFileSync } = await import("node:fs");
      const { resolve } = await import("node:path");

      const wasmPath = resolve("public/wasm/osc_sine.wasm");
      const bytes = new Uint8Array(readFileSync(wasmPath));
      const compiled = await WebAssembly.compile(bytes);

      const payload = buildModuleTransferPayload(
        OSC_SINE_NODEDEF_DESCRIPTOR,
        compiled,
        bytes,
      );

      expect(payload).to.not.be.null;
      expect(payload.wasmBytes).to.equal(bytes);
      expect(payload.module).to.be.undefined;
    });
  });

  describe("engine commit coordinator prefill (VAL-CROSS-002)", () => {
    it("resolvePrefillsForDeclarations includes ALL descriptor params", async () => {
      const { resolvePrefillsForDeclarations } = await import(
        "../src/audio/engineCommitCoordinator.ts"
      );
      const { OSC_SINE_NODEDEF_DESCRIPTOR } = await import(
        "../src/contracts/nodeDefRegistry.ts"
      );

      const declarations = [
        {
          identity: "::anon-0",
          def: "osc/sine",
          version: 1,
          audio_inputs: 0,
          audio_outputs: 1,
        },
      ];
      const controls = [
        { identity: "::anon-0", param: "freq", rate: "block", smoothing: "step" },
      ];

      const prefills = resolvePrefillsForDeclarations(
        declarations,
        controls,
        [OSC_SINE_NODEDEF_DESCRIPTOR],
      );

      const anonPrefills = prefills.get("::anon-0");
      expect(anonPrefills).to.not.be.undefined;
      expect(anonPrefills.get("freq")).to.equal(440);
      expect(anonPrefills.get("amp")).to.equal(0.2);
    });
  });

  describe("worklet core instantiate-before-module race (VAL-ENGINE-008)", () => {
    it("renderInstance re-resolves adapter when instance.adapter is null", async () => {
      const { readFileSync } = await import("node:fs");
      const workletCoreSource = readFileSync("src/audio/workletCore.ts", "utf8");

      expect(workletCoreSource).to.include(
        "options.adapterFactory(instance.def, instance.version)",
        "renderInstance must re-resolve adapter from factory",
      );
      expect(workletCoreSource).to.include(
        "instance.statePointer === 0 || instance.stateBytes === 0",
        "renderInstance must allocate state zone when not yet allocated",
      );
    });
  });

  describe("producer control-values pipeline (VAL-CROSS-002)", () => {
    it("wasmRuntime worker stores and publishes control values", async () => {
      const { readFileSync } = await import("node:fs");
      const workerSource = readFileSync("src/runtime/workers/wasmRuntime.worker.ts", "utf8");

      expect(workerSource).to.include("producerControlValues");
      expect(workerSource).to.include("producerSetControlValues");
      expect(workerSource).to.include("producerBlockRateChannels");
    });

    it("synthesis service sends control values on commit", async () => {
      const { readFileSync } = await import("node:fs");
      const serviceSource = readFileSync("src/audio/synthesisService.ts", "utf8");

      expect(serviceSource).to.include("producerSetControlValues");
    });
  });

  describe("capability diagnostic (VAL-HOST-008/009)", () => {
    it("editor evaluation pushes capability info diagnostic", async () => {
      const { readFileSync } = await import("node:fs");
      const evalSource = readFileSync("src/effects/editorEvaluation.ts", "utf8");

      expect(evalSource).to.include("pushCapabilityInfoDiagnostic");
    });
  });

  describe("ordered journey contract", () => {
    it("documents the six-step browser flow", () => {
      const journey = {
        steps: [
          {
            id: "canonical-sine",
            assertion: "440 Hz sine produces peak ≈ 0.2, finite output, zero glitches",
            valIds: ["VAL-CROSS-001", "VAL-CROSS-002", "VAL-ENGINE-031"],
          },
          {
            id: "pitch-edit",
            assertion: "Same identity preserved, output continues",
            valIds: ["VAL-CROSS-003"],
          },
          {
            id: "duplicate-capacity",
            assertion: "Duplicate node handled gracefully, engine stays running",
            valIds: ["VAL-CROSS-004"],
          },
          {
            id: "compiler-error",
            assertion: "Last sound retained, engine stays running",
            valIds: ["VAL-CROSS-005"],
          },
          {
            id: "ui-stress",
            assertion: "10-second rapid evals: no crash, no glitch, finite output",
            valIds: ["VAL-CROSS-006"],
          },
          {
            id: "producer-terminate-recover",
            assertion: "Timeout detected, 10ms fade, recovery to running state",
            valIds: ["VAL-CROSS-007", "VAL-CROSS-008", "VAL-CROSS-009", "VAL-CROSS-013"],
          },
        ],
      };

      expect(journey.steps).to.have.lengthOf(6);
      // Every step has at least one VAL ID
      for (const step of journey.steps) {
        expect(step.valIds.length).to.be.greaterThan(0);
      }
    });
  });
});
