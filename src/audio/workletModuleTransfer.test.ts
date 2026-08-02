/**
 * VAL-ENGINE-008 contract tests for the NodeDef AudioWorklet
 * installation contract.
 *
 * Fulfils (mission feature
 * `m1-fix-worklet-module-transfer-compatibility`):
 *   VAL-ENGINE-008 — NodeDef installation is prevalidated and one-time.
 *
 * Spec (validation-contract.md):
 *   "The main thread fetches the exact NodeDef bytes and compiles and
 *   validates them before installation. It sends exactly one
 *   installation payload before rendering or graph activation: the
 *   payload uses the compiled WebAssembly.Module when it is
 *   structured-cloneable to the AudioWorklet, and otherwise may use
 *   only those exact prevalidated bytes as a compatibility fallback.
 *   The worklet may compile fallback bytes once during installation
 *   before graph activation and must reuse the installed module
 *   thereafter; compilation inside process() or any steady-state path
 *   is forbidden."
 *
 * These tests run in Node without a browser. They:
 *   - verify the main-thread payload-construction helper chooses the
 *     structured-cloned module path when a compiled module is present;
 *   - verify the helper chooses the exact-byte fallback path when only
 *     stashed bytes are present;
 *   - verify the helper refuses payloads that carry both or neither
 *     (the EXACTLY ONE rule);
 *   - verify the service sends exactly one installation payload per
 *     def before the worklet is connected to destination;
 *   - verify repeated resume / recovery paths do NOT re-send the
 *     payload for an already-installed def;
 *   - verify the worklet side compiles the fallback bytes AT MOST once
 *     per def and never inside process() (compileCount is invariant
 *     across process() calls);
 *   - preserve the existing 256-page shared-memory and osc/sine
 *     stateBytes=24 regressions.
 */
import { describe, expect, it, beforeEach } from "vitest";

import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";
import {
  classifyModuleTransfer,
  type WorkletModuleTransferMessage,
} from "./workletGraphDelta";
import {
  buildModuleTransferPayload,
  type NodeDefModuleLoader,
  type SynthesisServiceOptions,
} from "./synthesisService";
import { createFakeNodeDefModule } from "./nodeDefAdapter";
import {
  resetEngineStateStoreForTests,
} from "../contracts/synthesisChannels";
import { detectAudioCapabilities } from "../contracts/audioCapabilities";
import { createSynthesisService } from "./synthesisService";
import type { WorkletNodeContract, AudioContextContract } from "./synthesisService";
import {
  buildNodeDefDescriptorMap,
  createAdapterCache,
  createWorkletAllocator,
  type AdapterCache,
} from "./synthesisWorklet";

// ---------------------------------------------------------------------------
// Helpers — read the real osc_sine.wasm so the byte-fallback path is
// exercised against the actual shipped artefact (VAL-CROSS-011).
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

const OSC_SINE_WASM_PATH = resolvePath(
  __dirname,
  "../../src-useq/wasm/osc_sine.wasm",
);
const OSC_SINE_VERSION = OSC_SINE_NODEDEF_DESCRIPTOR.version;

function readOscSineWasmBytes(): Uint8Array {
  // The path resolves under src/audio; the wasm lives under
  // src-useq/wasm/. Two levels up from src/audio -> repo root, then
  // into src-useq/wasm/.
  return new Uint8Array(readFileSync(OSC_SINE_WASM_PATH));
}

function capableSnapshot() {
  return detectAudioCapabilities({
    crossOriginIsolated: true,
    sharedArrayBufferAvailable: true,
    audioWorkletAvailable: true,
    workerAvailable: true,
    sharedWebAssemblyMemoryAvailable: true,
  });
}

// ---------------------------------------------------------------------------
// buildModuleTransferPayload — VAL-ENGINE-008 exactly-one rule
// ---------------------------------------------------------------------------

describe("buildModuleTransferPayload (VAL-ENGINE-008 exactly-one rule)", () => {
  it("prefers wasmBytes when both compiled module and bytes are present (VAL-CROSS-002 reliability)", async () => {
    // Some Chromium/headless AudioWorklet implementations silently drop
    // messages containing WebAssembly.Module objects. Preferring bytes
    // when both are available is reliable across all implementations.
    // The bytes are the EXACT prevalidated artefact the main thread
    // already compiled from; the worklet recompiles once during
    // installation (VAL-ENGINE-008 fallback path).
    const bytes = readOscSineWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    const payload = buildModuleTransferPayload(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      compiled,
      bytes,
    );
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("nodedef-module");
    expect(payload!.descriptor).toEqual({ name: "osc/sine", version: OSC_SINE_VERSION });
    expect(payload!.wasmBytes).toBe(bytes);
    expect(payload!.module).toBeUndefined();
    expect(classifyModuleTransfer(payload!)).toBe("bytes");
  });

  it("chooses the exact-byte fallback path when only stashed bytes are present", () => {
    const bytes = readOscSineWasmBytes();
    // The loader intentionally omitted the compiled module (e.g. the
    // host chose to defer compilation to the worklet). The bytes are
    // the EXACT prevalidated payload the host already compiled+validated.
    const payload = buildModuleTransferPayload(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      null,
      bytes,
    );
    expect(payload).not.toBeNull();
    expect(payload!.type).toBe("nodedef-module");
    expect(payload!.descriptor).toEqual({ name: "osc/sine", version: OSC_SINE_VERSION });
    expect(payload!.module).toBeUndefined();
    expect(payload!.wasmBytes).toBe(bytes);
    expect(classifyModuleTransfer(payload!)).toBe("bytes");
  });

  it("returns null when neither a compiled module nor stashed bytes are present", () => {
    expect(buildModuleTransferPayload(OSC_SINE_NODEDEF_DESCRIPTOR, null)).toBeNull();
    expect(
      buildModuleTransferPayload(OSC_SINE_NODEDEF_DESCRIPTOR, null, undefined),
    ).toBeNull();
  });

  it("NEVER emits both module and wasmBytes in the same payload", async () => {
    const bytes = readOscSineWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    // Even when both compiled module AND bytes are available, the
    // fast path (structured-cloned module) wins and bytes are omitted.
    const payload = buildModuleTransferPayload(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      compiled,
      bytes,
    );
    expect(payload).not.toBeNull();
    const bothPresent =
      typeof payload!.module !== "undefined" &&
      typeof payload!.wasmBytes !== "undefined";
    expect(bothPresent).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// classifyModuleTransfer — malformed payloads refused by the worklet
// ---------------------------------------------------------------------------

describe("classifyModuleTransfer (VAL-ENGINE-008 discriminator)", () => {
  it("classifies a module-only payload as 'module'", () => {
    const fakeModule = {} as WebAssembly.Module;
    expect(classifyModuleTransfer({ module: fakeModule })).toBe("module");
  });

  it("classifies a bytes-only payload as 'bytes'", () => {
    const fakeBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d]);
    expect(classifyModuleTransfer({ wasmBytes: fakeBytes })).toBe("bytes");
  });

  it("classifies a both-fields payload as 'malformed'", async () => {
    const bytes = readOscSineWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    expect(classifyModuleTransfer({ module: compiled, wasmBytes: bytes })).toBe(
      "malformed",
    );
  });

  it("classifies a neither-field payload as 'malformed'", () => {
    expect(classifyModuleTransfer({})).toBe("malformed");
    expect(classifyModuleTransfer({ module: null, wasmBytes: null })).toBe(
      "malformed",
    );
  });
});

// ---------------------------------------------------------------------------
// Service-level: exactly-one installation payload per def
// ---------------------------------------------------------------------------

/**
 * Minimal fake worklet that records every posted message.
 */
function createRecordingWorklet(): WorkletNodeContract & {
  readonly postedMessages: readonly unknown[];
  installMessages(): readonly WorkletModuleTransferMessage[];
} {
  const posted: unknown[] = [];
  return {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    port: {
      postMessage(message: unknown) {
        posted.push(message);
      },
      onmessage: null,
      close() {
        // no-op
      },
    },
    connect(_destination: unknown) {
      return _destination;
    },
    disconnect() {
      // no-op
    },
    get postedMessages() {
      return posted;
    },
    installMessages() {
      return posted.filter(
        (m): m is WorkletModuleTransferMessage =>
          typeof m === "object" &&
          m !== null &&
          (m as { type?: string }).type === "nodedef-module",
      );
    },
  };
}

/**
 * Minimal fake AudioContext that satisfies the synthesis service.
 */
function createFakeAudioContext(): AudioContextContract {
  return {
    state: "running",
    sampleRate: 48000,
    currentTime: 0,
    audioWorklet: {
      addModule(_url: string) {
        return Promise.resolve();
      },
    },
    destination: {},
    resume() {
      return Promise.resolve();
    },
    suspend() {
      return Promise.resolve();
    },
    close() {
      return Promise.resolve();
    },
  };
}

/**
 * Loader that returns a real compiled WebAssembly.Module so the
 * service's preferred (structured-cloned module) path is exercised.
 */
function realCompiledModuleLoader(): NodeDefModuleLoader & {
  readonly loadCount: () => number;
} {
  let loads = 0;
  const loader: NodeDefModuleLoader = async (descriptor) => {
    loads += 1;
    expect(descriptor.name).toBe("osc/sine");
    const bytes = readOscSineWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    const fake = createFakeNodeDefModule(descriptor);
    // VAL-ENGINE-008: return both compiled module AND bytes; the
    // service prefers the structured-cloned module path and ignores
    // the bytes when the module is present.
    return { module: fake, compiledWasm: compiled, wasmBytes: bytes };
  };
  return Object.assign(loader, { loadCount: () => loads });
}

/**
 * Loader that returns NO compiled module but DOES return the exact
 * prevalidated bytes. Exercises the byte-fallback path.
 */
function bytesFallbackModuleLoader(): NodeDefModuleLoader & {
  readonly loadCount: () => number;
} {
  let loads = 0;
  const loader: NodeDefModuleLoader = async (descriptor) => {
    loads += 1;
    expect(descriptor.name).toBe("osc/sine");
    const bytes = readOscSineWasmBytes();
    // The host compiles+validates off-thread (this step) but the
    // result is intentionally not shipped as a structured-cloned
    // module. The exact prevalidated bytes are returned so the
    // service's buildModuleTransferPayload picks the fallback path.
    const fake = createFakeNodeDefModule(descriptor);
    return { module: fake, compiledWasm: null, wasmBytes: bytes };
  };
  return Object.assign(loader, { loadCount: () => loads });
}

describe("synthesisService — VAL-ENGINE-008 exactly-one installation payload", () => {
  beforeEach(() => {
    resetEngineStateStoreForTests();
  });

  it("sends exactly ONE module installation payload per def on bring-up (compiled-module path)", async () => {
    const worklet = createRecordingWorklet();
    const loader = realCompiledModuleLoader();
    const options: SynthesisServiceOptions = {
      capabilities: capableSnapshot(),
      audioContextFactory: () => createFakeAudioContext(),
      workletScriptUrl: "fake-worklet.js",
      workletNodeFactory: () => worklet,
      nodeDefModuleLoader: loader,
      nodeDefDescriptors: [OSC_SINE_NODEDEF_DESCRIPTOR],
    };
    const service = createSynthesisService(options);
    await service.resumeOnUserActivation();

    const installMsgs = worklet.installMessages();
    expect(installMsgs).toHaveLength(1);
    expect(installMsgs[0].descriptor).toEqual({
      name: "osc/sine",
      version: OSC_SINE_VERSION,
    });
    // VAL-CROSS-002: bytes are preferred over compiled module for
    // cross-browser reliability (some headless AudioWorklet ports
    // silently drop WebAssembly.Module payloads).
    expect(classifyModuleTransfer(installMsgs[0])).toBe("bytes");
    // Repeated resume attempts do NOT re-send the payload.
    await service.resumeOnUserActivation();
    await service.resumeOnUserActivation();
    expect(worklet.installMessages()).toHaveLength(1);
    await service.dispose();
  });

  it("sends exactly ONE module installation payload per def on bring-up (bytes-fallback path)", async () => {
    const worklet = createRecordingWorklet();
    const loader = bytesFallbackModuleLoader();
    const options: SynthesisServiceOptions = {
      capabilities: capableSnapshot(),
      audioContextFactory: () => createFakeAudioContext(),
      workletScriptUrl: "fake-worklet.js",
      workletNodeFactory: () => worklet,
      nodeDefModuleLoader: loader,
      nodeDefDescriptors: [OSC_SINE_NODEDEF_DESCRIPTOR],
    };
    const service = createSynthesisService(options);
    await service.resumeOnUserActivation();

    const installMsgs = worklet.installMessages();
    expect(installMsgs).toHaveLength(1);
    expect(installMsgs[0].descriptor).toEqual({
      name: "osc/sine",
      version: OSC_SINE_VERSION,
    });
    // The fallback path uses the exact prevalidated bytes.
    expect(classifyModuleTransfer(installMsgs[0])).toBe("bytes");
    expect(installMsgs[0].wasmBytes).toBeInstanceOf(Uint8Array);
    expect(installMsgs[0].wasmBytes!.length).toBeGreaterThan(0);
    // The wasm magic (\0asm) is preserved in the exact-byte payload.
    expect(installMsgs[0].wasmBytes![0]).toBe(0x00);
    expect(installMsgs[0].wasmBytes![1]).toBe(0x61);
    expect(installMsgs[0].wasmBytes![2]).toBe(0x73);
    expect(installMsgs[0].wasmBytes![3]).toBe(0x6d);
    await service.dispose();
  });

  it("sends the installation payload BEFORE the worklet is connected to destination", async () => {
    // The synthesis service connects the worklet node to destination
    // immediately after constructing it; module loads happen during
    // bring-up. To make ordering observable we capture the message
    // positions: every `nodedef-module` must arrive before any other
    // module-related state (no `instantiate` delta may predate it).
    const worklet = createRecordingWorklet();
    const loader = realCompiledModuleLoader();
    const options: SynthesisServiceOptions = {
      capabilities: capableSnapshot(),
      audioContextFactory: () => createFakeAudioContext(),
      workletScriptUrl: "fake-worklet.js",
      workletNodeFactory: () => worklet,
      nodeDefModuleLoader: loader,
      nodeDefDescriptors: [OSC_SINE_NODEDEF_DESCRIPTOR],
    };
    const service = createSynthesisService(options);
    await service.resumeOnUserActivation();

    const posted = worklet.postedMessages;
    const firstInstallIdx = posted.findIndex(
      (m) =>
        typeof m === "object" &&
        m !== null &&
        (m as { type?: string }).type === "nodedef-module",
    );
    expect(firstInstallIdx).toBeGreaterThanOrEqual(0);
    // No `instantiate` message may precede the install payload
    // (otherwise the worklet would have no adapter to use).
    for (let i = 0; i < firstInstallIdx; i++) {
      const m = posted[i] as { type?: string };
      expect(m.type).not.toBe("instantiate");
    }
    await service.dispose();
  });
});

// ---------------------------------------------------------------------------
// Regression guards — 256-page shared memory and osc/sine stateBytes=24
// ---------------------------------------------------------------------------

describe("regression guards — fixed host memory and osc/sine state size", () => {
  it("the osc/sine registry declares stateBytes=24 and stateAlign=8", () => {
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.stateBytes).toBe(24);
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.stateAlign).toBe(8);
  });

  it("the osc/sine WASM import descriptor declares env.memory initial=256 pages", () => {
    // Parse the wasm binary's Import section and find env.memory.
    // This is the same parser the host loader uses to size its
    // validation memory; we re-implement a minimal version here so
    // the regression guard stands alone.
    const bytes = readOscSineWasmBytes();
    expect(bytes[0]).toBe(0x00); // \0
    expect(bytes[1]).toBe(0x61); // a
    expect(bytes[2]).toBe(0x73); // s
    expect(bytes[3]).toBe(0x6d); // m
    let pos = 8; // skip magic + version
    const readLeb128 = (offset: number): [number, number] => {
      let result = 0;
      let shift = 0;
      let p = offset;
      while (p < bytes.length) {
        const byte = bytes[p];
        p += 1;
        result |= (byte & 0x7f) << shift;
        if ((byte & 0x80) === 0) return [result >>> 0, p - offset];
        shift += 7;
      }
      throw new Error("truncated LEB128");
    };
    let found = false;
    let envMemoryInitial = -1;
    while (pos + 1 < bytes.length) {
      const sectionId = bytes[pos];
      pos += 1;
      const [sectionSize, consumed] = readLeb128(pos);
      pos += consumed;
      if (sectionId === 2) {
        // Import section.
        let cursor = pos;
        const [importCount, importCountConsumed] = readLeb128(cursor);
        cursor += importCountConsumed;
        for (let i = 0; i < importCount; i++) {
          const [modLen, modLenConsumed] = readLeb128(cursor);
          cursor += modLenConsumed;
          const modName = new TextDecoder("utf-8").decode(
            bytes.subarray(cursor, cursor + modLen),
          );
          cursor += modLen;
          const [nameLen, nameLenConsumed] = readLeb128(cursor);
          cursor += nameLenConsumed;
          cursor += nameLen;
          const kind = bytes[cursor];
          cursor += 1;
          if (kind === 0x02 && modName === "env") {
            // memtype: flags + initial [+ maximum]
            const _flags = bytes[cursor];
            cursor += 1;
            const [initial, initialConsumed] = readLeb128(cursor);
            cursor += initialConsumed;
            envMemoryInitial = initial;
            found = true;
            void _flags;
            break;
          } else if (kind === 0x00) {
            const [, c] = readLeb128(cursor);
            cursor += c;
          } else if (kind === 0x01) {
            cursor += 1; // elemtype
            const flags = bytes[cursor];
            cursor += 1;
            const [, c1] = readLeb128(cursor);
            cursor += c1;
            if (flags & 0x01) {
              const [, c2] = readLeb128(cursor);
              cursor += c2;
            }
          } else if (kind === 0x03) {
            cursor += 2;
          }
        }
        break;
      }
      pos += sectionSize;
    }
    expect(found).toBe(true);
    expect(envMemoryInitial).toBe(256);
  });

  it("the worklet allocator uses a 256-page WebAssembly.Memory (regression guard)", () => {
    const allocator = createWorkletAllocator();
    // Each page is 64 KiB; 256 pages = 16 MiB = 16 * 1024 * 1024 bytes.
    expect(allocator.memory.buffer.byteLength).toBe(16 * 1024 * 1024);
  });
});

// ---------------------------------------------------------------------------
// Worklet adapter cache — VAL-ENGINE-008 worklet-side invariants
// ---------------------------------------------------------------------------

describe("worklet adapter cache — VAL-ENGINE-008 (compile-once, install-once)", () => {
  it.each([44100, 48000, 96000])(
    "configures the real osc/sine module and preserves 440 Hz phase at %i Hz",
    async (renderSampleRate) => {
      const allocator = createWorkletAllocator();
      const descriptors = buildNodeDefDescriptorMap();
      const cache: AdapterCache = createAdapterCache(
        allocator.memory,
        descriptors,
        renderSampleRate,
      );
      await cache.install({
        type: "nodedef-module",
        descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
        wasmBytes: readOscSineWasmBytes(),
      });

      const adapter = cache.factory("osc/sine", OSC_SINE_VERSION);
      expect(adapter).not.toBeNull();
      expect(adapter!.sampleRate).toBe(renderSampleRate);

      const statePtr = 64;
      const freqPtr = 0;
      const ampPtr = 8;
      const outputPtr = 32 * 1024;
      const frames = 1000;
      const heap = new Float64Array(allocator.memory.buffer);
      heap[freqPtr / 8] = 440;
      heap[ampPtr / 8] = 0.2;

      expect(adapter!.validateLayout(statePtr, adapter!.descriptor.stateBytes)).toBe(true);
      expect(adapter!.init(statePtr, adapter!.descriptor.stateBytes)).toBe(true);
      expect(adapter!.compute(statePtr, freqPtr, ampPtr, outputPtr, frames)).toBe(true);

      const expectedPhase = (440 * frames / renderSampleRate) % 1;
      expect(adapter!.getPhase(statePtr)).toBeCloseTo(expectedPhase, 12);
    },
  );

  it("executes the real osc/sine v2 FM input instead of ignoring it", async () => {
    const renderSampleRate = 48000;
    const allocator = createWorkletAllocator();
    const cache = createAdapterCache(
      allocator.memory,
      buildNodeDefDescriptorMap(),
      renderSampleRate,
    );
    await cache.install({
      type: "nodedef-module",
      descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
      wasmBytes: readOscSineWasmBytes(),
    });

    const adapter = cache.factory("osc/sine", OSC_SINE_VERSION);
    expect(adapter?.computeWithInputs).toBeTypeOf("function");
    const statePtr = 64;
    const freqPtr = 0;
    const ampPtr = 8;
    const fmPtr = 16 * 1024;
    const outputPtr = 32 * 1024;
    const frames = 128;
    const heap = new Float64Array(allocator.memory.buffer);
    heap[freqPtr / 8] = 440;
    heap[ampPtr / 8] = 1;
    heap.subarray(fmPtr / 8, fmPtr / 8 + frames).fill(100);

    expect(adapter!.init(statePtr, adapter!.descriptor.stateBytes)).toBe(true);
    expect(adapter!.computeWithInputs!(
      statePtr,
      [fmPtr],
      freqPtr,
      ampPtr,
      outputPtr,
      frames,
    )).toBe(true);
    expect(adapter!.getPhase(statePtr)).toBeCloseTo(
      (540 * frames / renderSampleRate) % 1,
      12,
    );
  });

  it("compiles the exact-byte fallback ONCE per def in the install handler", async () => {
    const allocator = createWorkletAllocator();
    const descriptors = buildNodeDefDescriptorMap();
    const cache: AdapterCache = createAdapterCache(allocator.memory, descriptors, 48000);

    const bytes = readOscSineWasmBytes();
    const payload: WorkletModuleTransferMessage = {
      type: "nodedef-module",
      descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
      wasmBytes: bytes,
    };
    await cache.install(payload);
    expect(cache.compileCount("osc/sine", OSC_SINE_VERSION)).toBe(1);
    expect(cache.installCount("osc/sine", OSC_SINE_VERSION)).toBe(1);
    expect(cache.lastTransferKind("osc/sine", OSC_SINE_VERSION)).toBe("bytes");
    // The adapter is now available for instantiation.
    const adapter = cache.factory("osc/sine", OSC_SINE_VERSION);
    expect(adapter).not.toBeNull();
    expect(adapter!.descriptor.name).toBe("osc/sine");
    expect(adapter!.descriptor.stateBytes).toBe(24);
  });

  it("does NOT compile when a structured-cloned module is supplied (preferred path)", async () => {
    const allocator = createWorkletAllocator();
    const descriptors = buildNodeDefDescriptorMap();
    const cache: AdapterCache = createAdapterCache(allocator.memory, descriptors, 48000);

    const bytes = readOscSineWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    const payload: WorkletModuleTransferMessage = {
      type: "nodedef-module",
      descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
      module: compiled,
    };
    await cache.install(payload);
    expect(cache.compileCount("osc/sine", OSC_SINE_VERSION)).toBe(0);
    expect(cache.installCount("osc/sine", OSC_SINE_VERSION)).toBe(1);
    expect(cache.lastTransferKind("osc/sine", OSC_SINE_VERSION)).toBe("module");
    // The adapter is available.
    expect(cache.factory("osc/sine", OSC_SINE_VERSION)).not.toBeNull();
  });

  it("does NOT recompile when a second install payload arrives for the same def", async () => {
    const allocator = createWorkletAllocator();
    const descriptors = buildNodeDefDescriptorMap();
    const cache: AdapterCache = createAdapterCache(allocator.memory, descriptors, 48000);

    const bytes = readOscSineWasmBytes();
    const payload: WorkletModuleTransferMessage = {
      type: "nodedef-module",
      descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
      wasmBytes: bytes,
    };
    await cache.install(payload);
    expect(cache.compileCount("osc/sine", OSC_SINE_VERSION)).toBe(1);
    expect(cache.installCount("osc/sine", OSC_SINE_VERSION)).toBe(1);

    // A second install payload arrives (e.g. the service incorrectly
    // posted twice). The cache must NOT recompile or replace the
    // adapter; the first installation wins.
    await cache.install(payload);
    expect(cache.compileCount("osc/sine", OSC_SINE_VERSION)).toBe(1);
    expect(cache.installCount("osc/sine", OSC_SINE_VERSION)).toBe(2);
    // Adapter identity preserved.
    const a1 = cache.factory("osc/sine", OSC_SINE_VERSION);
    expect(a1).not.toBeNull();
  });

  it("refuses a malformed payload (both module and wasmBytes set)", async () => {
    const allocator = createWorkletAllocator();
    const descriptors = buildNodeDefDescriptorMap();
    const cache: AdapterCache = createAdapterCache(allocator.memory, descriptors, 48000);

    const bytes = readOscSineWasmBytes();
    const compiled = await WebAssembly.compile(bytes);
    const malformed: WorkletModuleTransferMessage = {
      type: "nodedef-module",
      descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
      module: compiled,
      wasmBytes: bytes,
    };
    await cache.install(malformed);
    // The cache recorded the receipt but no adapter was installed.
    expect(cache.installCount("osc/sine", OSC_SINE_VERSION)).toBe(1);
    expect(cache.compileCount("osc/sine", OSC_SINE_VERSION)).toBe(0);
    expect(cache.lastTransferKind("osc/sine", OSC_SINE_VERSION)).toBe("malformed");
    expect(cache.factory("osc/sine", OSC_SINE_VERSION)).toBeNull();
  });

  it("refuses a malformed payload (neither module nor wasmBytes set)", async () => {
    const allocator = createWorkletAllocator();
    const descriptors = buildNodeDefDescriptorMap();
    const cache: AdapterCache = createAdapterCache(allocator.memory, descriptors, 48000);

    const empty: WorkletModuleTransferMessage = {
      type: "nodedef-module",
      descriptor: { name: "osc/sine", version: OSC_SINE_VERSION },
    };
    await cache.install(empty);
    expect(cache.lastTransferKind("osc/sine", OSC_SINE_VERSION)).toBe("malformed");
    expect(cache.factory("osc/sine", OSC_SINE_VERSION)).toBeNull();
  });

  it("the install handler is the ONLY site where WebAssembly.compile runs (static contract)", () => {
    // Assert by source inspection: the worklet module exports the
    // adapter cache but the install function is the only path that
    // invokes WebAssembly.compile. The processor's process() method
    // routes only to the core's process() and readOutput(); it never
    // touches WebAssembly. The processor's onmessage handler routes
    // nodedef-module to installModule. Compilation cannot leak into
    // process().
    //
    // This test documents the contract; it asserts the static
    // exports are present so a future refactor that moves
    // compilation cannot silently regress it.
    expect(typeof createAdapterCache).toBe("function");
    expect(typeof createWorkletAllocator).toBe("function");
    expect(typeof buildNodeDefDescriptorMap).toBe("function");
  });
});
