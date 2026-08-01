import { describe, expect, it } from "vitest";

import {
  buildSynthProducerControlBindings,
  validateSynthProducerControlBindings,
  validateSynthProducerControlBindingsAgainstControls,
} from "./synthProducerControlMapping";
import { controlChannelKey } from "./synthesisControlAbi";
import type { SynthProducerControlBinding } from "./runtimeTypes";

describe("compiler-control to producer-SAB mapping", () => {
  it("retains compiler order and original indices across fast-rate filtering", () => {
    const bindings = buildSynthProducerControlBindings([
      { identity: "carrier", param: "freq", rate: "block", smoothing: "step" },
      { identity: "lfo", param: "phase", rate: "fast", smoothing: "step" },
      { identity: "carrier", param: "amp", rate: "block", smoothing: "linear" },
      { identity: "lfo", param: "freq", rate: "block", smoothing: "step" },
    ]);

    expect(bindings).toEqual([
      {
        identity: "carrier",
        param: "freq",
        channelKey: controlChannelKey("carrier", "freq"),
        compilerControlIndex: 0,
      },
      {
        identity: "carrier",
        param: "amp",
        channelKey: controlChannelKey("carrier", "amp"),
        compilerControlIndex: 2,
      },
      {
        identity: "lfo",
        param: "freq",
        channelKey: controlChannelKey("lfo", "freq"),
        compilerControlIndex: 3,
      },
    ]);
    expect(validateSynthProducerControlBindings(4, bindings, 3)).toEqual({ ok: true });
  });

  it.each([
    ["permuted indices", [
      binding("a", "freq", 1),
      binding("b", "freq", 0),
    ]],
    ["duplicate indices", [
      binding("a", "freq", 0),
      binding("b", "freq", 0),
    ]],
    ["out-of-range index", [binding("a", "freq", 2)]],
    ["forged key", [{ ...binding("a", "freq", 0), channelKey: "b\0freq" }]],
    ["duplicate key", [
      binding("a", "freq", 0),
      binding("a", "freq", 1),
    ]],
  ])("rejects %s", (_label, bindings) => {
    expect(validateSynthProducerControlBindings(
      2,
      bindings as SynthProducerControlBinding[],
      8,
    ).ok).toBe(false);
  });

  it("rejects mapping rows beyond the SAB pool", () => {
    expect(validateSynthProducerControlBindings(
      2,
      [binding("a", "freq", 0), binding("b", "freq", 1)],
      1,
    ).ok).toBe(false);
  });

  it("rejects a self-consistent binding forged against another compiler row", () => {
    const controls = [
      { identity: "lead", param: "freq", rate: "block", smoothing: "step" },
    ] as const;
    expect(validateSynthProducerControlBindingsAgainstControls(
      controls,
      [binding("bass", "freq", 0)],
      8,
    ).ok).toBe(false);
  });

  it("rejects omission of a compiler block-rate row", () => {
    const controls = [
      { identity: "lead", param: "freq", rate: "block", smoothing: "step" },
      { identity: "lead", param: "phase", rate: "fast", smoothing: "step" },
      { identity: "lead", param: "amp", rate: "block", smoothing: "linear" },
    ] as const;
    expect(validateSynthProducerControlBindingsAgainstControls(
      controls,
      [binding("lead", "freq", 0)],
      8,
    ).ok).toBe(false);
  });
});

function binding(
  identity: string,
  param: string,
  compilerControlIndex: number,
): SynthProducerControlBinding {
  return {
    identity,
    param,
    channelKey: controlChannelKey(identity, param),
    compilerControlIndex,
  };
}
