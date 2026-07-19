/**
 * Contract tests for the source-agnostic NodeDef adapter.
 *
 * Covers (partial — see mission feature
 * `m1-synthesis-service-and-devmode-contract`):
 *   VAL-DSP-006 — the normalized host adapter can instantiate and render
 *                 the NodeDef using registry metadata alone, without hand-
 *                 written C++ implementation knowledge.
 *
 * These tests were OBSERVED FAILING before the adapter module was added
 * (the imports did not resolve). They pass after the canonical surfaces
 * are in place.
 */
import { describe, expect, it } from "vitest";

import {
  OSC_SINE_NODEDEF_DESCRIPTOR,
  buildNodeDefParamTable,
  findNodeDefDescriptor,
  isNodeDefDescriptor,
  nodeDefDescriptorsEqual,
} from "./nodeDefRegistry";

import {
  NodeDefAdapterError,
  createFakeNodeDefModule,
  createNodeDefAdapter,
} from "../audio/nodeDefAdapter";

describe("nodeDefRegistry — schema", () => {
  it("exposes osc/sine v1 with the canonical defaults", () => {
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.name).toBe("osc/sine");
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.version).toBe(1);
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.audioInputs).toBe(0);
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.audioOutputs).toBe(1);
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.voiceFanout).toBe(false);
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.fadeInMs).toBe(10);
    expect(OSC_SINE_NODEDEF_DESCRIPTOR.fadeOutMs).toBe(30);

    const freq = OSC_SINE_NODEDEF_DESCRIPTOR.params.find((p) => p.name === "freq");
    expect(freq?.default).toBe(440);
    expect(freq?.rate).toBe("block");
    expect(freq?.smoothing).toBe("step");

    const amp = OSC_SINE_NODEDEF_DESCRIPTOR.params.find((p) => p.name === "amp");
    expect(amp?.default).toBe(0.2);
    expect(amp?.rate).toBe("block");
    expect(amp?.smoothing).toBe("linear");
  });

  it("findNodeDefDescriptor returns the descriptor by (name, version)", () => {
    expect(findNodeDefDescriptor("osc/sine", 1)).toBe(OSC_SINE_NODEDEF_DESCRIPTOR);
    expect(findNodeDefDescriptor("osc/sine", 2)).toBeNull();
    expect(findNodeDefDescriptor("osc/saw", 1)).toBeNull();
  });

  it("buildNodeDefParamTable returns a name → param map", () => {
    const table = buildNodeDefParamTable(OSC_SINE_NODEDEF_DESCRIPTOR);
    expect(table.size).toBe(2);
    expect(table.get("freq")?.default).toBe(440);
    expect(table.get("amp")?.default).toBe(0.2);
    expect(table.get("nope")).toBeUndefined();
  });
});

describe("nodeDefRegistry — validation", () => {
  it("isNodeDefDescriptor narrows well-formed descriptors", () => {
    expect(isNodeDefDescriptor(OSC_SINE_NODEDEF_DESCRIPTOR)).toBe(true);

    // Garbage is rejected.
    expect(isNodeDefDescriptor(null)).toBe(false);
    expect(isNodeDefDescriptor({})).toBe(false);
    expect(isNodeDefDescriptor({ ...OSC_SINE_NODEDEF_DESCRIPTOR, name: "" })).toBe(false);
    expect(isNodeDefDescriptor({ ...OSC_SINE_NODEDEF_DESCRIPTOR, version: 0 })).toBe(false);
    expect(isNodeDefDescriptor({ ...OSC_SINE_NODEDEF_DESCRIPTOR, audioInputs: -1 })).toBe(false);
    expect(
      isNodeDefDescriptor({
        ...OSC_SINE_NODEDEF_DESCRIPTOR,
        params: "nope",
      }),
    ).toBe(false);
  });

  it("isNodeDefDescriptor rejects params with invalid rate or smoothing", () => {
    const bad = {
      ...OSC_SINE_NODEDEF_DESCRIPTOR,
      params: [
        { name: "freq", default: 440, rate: "minute", smoothing: "step" },
      ],
    };
    expect(isNodeDefDescriptor(bad)).toBe(false);
  });

  it("nodeDefDescriptorsEqual matches on every field", () => {
    expect(nodeDefDescriptorsEqual(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      OSC_SINE_NODEDEF_DESCRIPTOR,
    )).toBe(true);

    // Different name.
    expect(nodeDefDescriptorsEqual(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      { ...OSC_SINE_NODEDEF_DESCRIPTOR, name: "osc/saw" },
    )).toBe(false);

    // Different version.
    expect(nodeDefDescriptorsEqual(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      { ...OSC_SINE_NODEDEF_DESCRIPTOR, version: 2 },
    )).toBe(false);

    // Different default.
    const withOtherFreq = {
      ...OSC_SINE_NODEDEF_DESCRIPTOR,
      params: [
        { name: "freq", default: 220, rate: "block", smoothing: "step" },
        OSC_SINE_NODEDEF_DESCRIPTOR.params[1],
      ],
    };
    expect(nodeDefDescriptorsEqual(
      OSC_SINE_NODEDEF_DESCRIPTOR,
      withOtherFreq,
    )).toBe(false);
  });
});

describe("nodeDefAdapter — VAL-DSP-006: source-agnostic instantiation", () => {
  it("constructs an adapter against a matching module", () => {
    const fake = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
    const adapter = createNodeDefAdapter(fake, OSC_SINE_NODEDEF_DESCRIPTOR);

    expect(adapter.descriptor).toBe(OSC_SINE_NODEDEF_DESCRIPTOR);
    expect(adapter.params.size).toBe(2);
    expect(adapter.params.get("freq")?.default).toBe(440);
  });

  it("init and compute route through the module's symbols without def-specific knowledge", () => {
    const fake = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
    const adapter = createNodeDefAdapter(fake, OSC_SINE_NODEDEF_DESCRIPTOR);

    // Host-supplied zone pointers. The adapter does not dereference them;
    // it forwards them to the module.
    const STATE_PTR = 1024;
    const STATE_BYTES = OSC_SINE_NODEDEF_DESCRIPTOR.stateBytes;
    const FREQ_PTR = 2048;
    const AMP_PTR = 2056;
    const OUT_PTR = 3072;
    const FRAMES = 128;

    expect(adapter.validateLayout(STATE_PTR, STATE_BYTES)).toBe(true);
    expect(adapter.init(STATE_PTR, STATE_BYTES)).toBe(true);
    expect(
      adapter.compute(STATE_PTR, FREQ_PTR, AMP_PTR, OUT_PTR, FRAMES),
    ).toBe(true);

    // The fake records every call so tests can assert that the adapter
    // used the descriptor-supplied strides without hard-coding offsets.
    expect(fake.initCalls).toEqual([[STATE_PTR, STATE_BYTES]]);
    expect(fake.computeCalls).toEqual([
      [STATE_PTR, FREQ_PTR, AMP_PTR, OUT_PTR, FRAMES],
    ]);
  });

  it("surfaces validate_layout failures so the host can reject the zone", () => {
    const fake = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
    const adapter = createNodeDefAdapter(fake, OSC_SINE_NODEDEF_DESCRIPTOR);

    fake.setValidateLayoutResult(false);
    expect(adapter.validateLayout(0, 16)).toBe(false);
  });

  it("surfaces init / compute failures", () => {
    const fake = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
    const adapter = createNodeDefAdapter(fake, OSC_SINE_NODEDEF_DESCRIPTOR);

    fake.setInitResult(false);
    expect(adapter.init(0, 32)).toBe(false);

    fake.setInitResult(true);
    fake.setComputeResult(false);
    expect(adapter.compute(0, 0, 0, 0, 128)).toBe(false);
  });

  it("throws NodeDefAdapterError when the runtime descriptor does not match", () => {
    const fake = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
    // Editor-side descriptor with a different default.
    const stale = {
      ...OSC_SINE_NODEDEF_DESCRIPTOR,
      params: [
        { name: "freq", default: 220, rate: "block" as const, smoothing: "step" as const },
        OSC_SINE_NODEDEF_DESCRIPTOR.params[1],
      ],
    };
    expect(() => createNodeDefAdapter(fake, stale)).toThrowError(NodeDefAdapterError);
  });

  it("throws NodeDefAdapterError when a required export is missing", () => {
    // Build a module that omits `compute`.
    const partial = {
      lookup: (name: string) => {
        if (name === "compute" || name === "_compute") return undefined;
        return createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR).lookup(name);
      },
      runtimeDescriptor: OSC_SINE_NODEDEF_DESCRIPTOR,
    };
    expect(() => createNodeDefAdapter(partial, OSC_SINE_NODEDEF_DESCRIPTOR))
      .toThrowError(NodeDefAdapterError);
  });

  it("adapter is stateless apart from the module + descriptor (no per-instance data)", () => {
    // VAL-DSP-006: the adapter holds no per-instance state. Two
    // instances addressed by different pointers reuse the same adapter.
    const fake = createFakeNodeDefModule(OSC_SINE_NODEDEF_DESCRIPTOR);
    const adapter = createNodeDefAdapter(fake, OSC_SINE_NODEDEF_DESCRIPTOR);

    adapter.init(1000, 32);
    adapter.init(2000, 32);
    adapter.compute(1000, 0, 0, 0, 128);
    adapter.compute(2000, 0, 0, 0, 128);

    expect(fake.initCalls).toEqual([[1000, 32], [2000, 32]]);
    expect(fake.computeCalls).toEqual([
      [1000, 0, 0, 0, 128],
      [2000, 0, 0, 0, 128],
    ]);
  });
});
