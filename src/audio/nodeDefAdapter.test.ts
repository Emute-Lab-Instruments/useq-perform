import { afterEach, describe, expect, it, vi } from "vitest";

import { OSC_SINE_NODEDEF_DESCRIPTOR } from "../contracts/nodeDefRegistry";
import { readNodeDefRuntimeDescriptor } from "./nodeDefAdapter";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readNodeDefRuntimeDescriptor", () => {
  it("decodes UTF-8 when AudioWorkletGlobalScope has no TextDecoder", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const pointer = 64;
    const expected = {
      ...OSC_SINE_NODEDEF_DESCRIPTOR,
      name: "osc/sin\u00e9",
    };
    const encoded = new TextEncoder().encode(JSON.stringify(expected));
    new Uint8Array(memory.buffer, pointer, encoded.length).set(encoded);
    vi.stubGlobal("TextDecoder", undefined);

    const actual = readNodeDefRuntimeDescriptor(memory, (name) =>
      name === "registry_json" ? () => pointer : undefined,
    );

    expect(actual).toEqual(expected);
  });
});
