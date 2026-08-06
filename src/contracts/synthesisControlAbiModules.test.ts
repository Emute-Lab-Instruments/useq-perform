import { describe, expect, it } from "vitest";

import {
  ABI_VERSION,
  createSynthesisControlBuffer,
  validateBufferHeader,
} from "./synthesisControlAbi/layout.ts";
import { attachSynthesisControlView } from "./synthesisControlAbi/view.ts";
import { assertAbiLayoutInvariants } from "./synthesisControlAbi/pacing.ts";

describe("synthesis control ABI module boundaries", () => {
  it("layout owns creation and validation", () => {
    const buffer = createSynthesisControlBuffer({ blockRateCount: 3 });
    expect(() => validateBufferHeader(buffer)).not.toThrow();
  });

  it("view attaches typed ring access over a validated layout", () => {
    const view = attachSynthesisControlView(createSynthesisControlBuffer());
    expect(view.abiVersion).toBe(ABI_VERSION);
    expect(view.isRingEmpty()).toBe(true);
  });

  it("pacing module retains static layout invariant checks", () => {
    expect(() => assertAbiLayoutInvariants()).not.toThrow();
  });
});
