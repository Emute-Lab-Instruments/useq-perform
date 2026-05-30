import { describe, it, expect } from "vitest";
import { bindingsForProfile, profileIds } from "./profileRegistry.ts";
import { defaultKeyBindings } from "./defaults.ts";
import { simplifiedBindings } from "./profiles/simplified.ts";

describe("profileRegistry", () => {
  it("resolves the default profile", () => {
    expect(bindingsForProfile("default")).toBe(defaultKeyBindings);
  });

  it("resolves the simplified profile", () => {
    expect(bindingsForProfile("simplified")).toBe(simplifiedBindings);
  });

  it("falls back to default for unknown / undefined profile ids", () => {
    expect(bindingsForProfile("does-not-exist")).toBe(defaultKeyBindings);
    expect(bindingsForProfile(undefined)).toBe(defaultKeyBindings);
  });

  it("lists registered profile ids including default and simplified", () => {
    const ids = profileIds();
    expect(ids).toContain("default");
    expect(ids).toContain("simplified");
  });
});
