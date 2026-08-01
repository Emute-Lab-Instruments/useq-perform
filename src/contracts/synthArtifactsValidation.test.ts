import { describe, expect, it } from "vitest";

import {
  OSC_SINE_NODEDEF_DESCRIPTOR,
  type NodeDefDescriptor,
} from "./nodeDefRegistry";
import {
  SYNTH_ARTIFACT_ABI_VERSION,
  isSynthArtifactsPayload,
  validateSynthArtifactsPayload,
  type SynthArtifactsPayload,
} from "./runtimeTypes";

const ROUTER: NodeDefDescriptor = Object.freeze({
  ...OSC_SINE_NODEDEF_DESCRIPTOR,
  name: "test/router",
  audioInputs: 2,
  params: Object.freeze([]),
});

const descriptors = new Map<string, NodeDefDescriptor>([
  ["osc/sine\u00001", OSC_SINE_NODEDEF_DESCRIPTOR],
  ["test/router\u00001", ROUTER],
]);

function findDescriptor(name: string, version: number): NodeDefDescriptor | null {
  return descriptors.get(`${name}\u0000${version}`) ?? null;
}

function osc(identity: string) {
  return {
    identity,
    def: "osc/sine",
    version: 1,
    audio_inputs: 0,
    audio_outputs: 1,
  } as const;
}

function router(identity: string) {
  return {
    identity,
    def: "test/router",
    version: 1,
    audio_inputs: 2,
    audio_outputs: 1,
  } as const;
}

function validPayload(): SynthArtifactsPayload {
  return {
    abi: SYNTH_ARTIFACT_ABI_VERSION,
    revision: 1,
    declarations: [osc("lead")],
    controls: [
      { identity: "lead", param: "freq", rate: "block", smoothing: "step" },
      { identity: "lead", param: "amp", rate: "block", smoothing: "linear" },
    ],
  };
}

function validate(payload: unknown) {
  return validateSynthArtifactsPayload(payload, { findDescriptor });
}

describe("synth artefact boundary validation", () => {
  it("accepts the current ABI-1 osc/sine payload", () => {
    const payload = validPayload();
    expect(validate(payload)).toEqual({ ok: true, payload });
    expect(isSynthArtifactsPayload(payload)).toBe(true);
  });

  it.each([
    ["non-finite revision", { ...validPayload(), revision: Number.NaN }],
    ["fractional revision", { ...validPayload(), revision: 1.5 }],
    [
      "infinite declaration version",
      {
        ...validPayload(),
        declarations: [{ ...osc("lead"), version: Number.POSITIVE_INFINITY }],
      },
    ],
    [
      "negative declaration port count",
      {
        ...validPayload(),
        declarations: [{ ...osc("lead"), audio_outputs: -1 }],
      },
    ],
    [
      "duplicate identity",
      { ...validPayload(), declarations: [osc("lead"), osc("lead")] },
    ],
    [
      "forged declaration ports",
      {
        ...validPayload(),
        declarations: [{ ...osc("lead"), audio_inputs: 1 }],
      },
    ],
    [
      "unknown control owner",
      {
        ...validPayload(),
        controls: [
          { identity: "ghost", param: "freq", rate: "block", smoothing: "step" },
        ],
      },
    ],
    [
      "unknown parameter",
      {
        ...validPayload(),
        controls: [
          { identity: "lead", param: "wat", rate: "block", smoothing: "step" },
        ],
      },
    ],
    [
      "duplicate control key",
      {
        ...validPayload(),
        controls: [
          validPayload().controls[0],
          validPayload().controls[0],
        ],
      },
    ],
    [
      "control contract mismatch",
      {
        ...validPayload(),
        controls: [
          { identity: "lead", param: "freq", rate: "fast", smoothing: "step" },
        ],
      },
    ],
    [
      "control character in identity",
      {
        ...validPayload(),
        declarations: [osc("bad\u0000identity")],
      },
    ],
  ])("rejects %s", (_name, payload) => {
    expect(validate(payload).ok).toBe(false);
  });

  it("rejects unknown endpoints, out-of-range ports, and multiply-driven inputs", () => {
    const base = {
      abi: 1,
      revision: 1,
      declarations: [osc("source"), osc("other"), router("sink")],
      controls: [],
    } satisfies SynthArtifactsPayload;

    expect(
      validate({
        ...base,
        connections: [{ from: "ghost", to: "sink", port: "in", port_index: 0 }],
      }).ok,
    ).toBe(false);
    expect(
      validate({
        ...base,
        connections: [{ from: "source", to: "sink", port: "in", port_index: 2 }],
      }).ok,
    ).toBe(false);
    expect(
      validate({
        ...base,
        connections: [{ from: "source", to: "sink", port: "in", port_index: Number.NaN }],
      }).ok,
    ).toBe(false);
    expect(
      validate({
        ...base,
        connections: [
          { from: "source", to: "sink", port: "in", port_index: 0 },
          { from: "other", to: "sink", port: "in", port_index: 0 },
        ],
      }).ok,
    ).toBe(false);
  });

  it("accepts acyclic routing and rejects direct and indirect cycles", () => {
    const acyclic = {
      abi: 1,
      revision: 2,
      declarations: [osc("source"), router("middle"), router("sink")],
      controls: [],
      connections: [
        { from: "source", to: "middle", port: "in", port_index: 0 },
        { from: "middle", to: "sink", port: "in", port_index: 0 },
      ],
    } satisfies SynthArtifactsPayload;
    expect(validate(acyclic).ok).toBe(true);

    expect(
      validate({
        ...acyclic,
        connections: [{ from: "middle", to: "middle", port: "in", port_index: 0 }],
      }),
    ).toMatchObject({ ok: false, code: "cyclic-routing" });
    expect(
      validate({
        ...acyclic,
        connections: [
          { from: "middle", to: "sink", port: "in", port_index: 0 },
          { from: "sink", to: "middle", port: "in", port_index: 0 },
        ],
      }),
    ).toMatchObject({ ok: false, code: "cyclic-routing" });
  });
});
