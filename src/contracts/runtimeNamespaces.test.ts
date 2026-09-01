import { describe, expect, it } from "vitest";
import {
  HARDWARE_ONLY_NAMESPACES,
  usesHardwareOnlyNamespace,
} from "./runtimeNamespaces.ts";

describe("hardware-only runtime namespaces", () => {
  it("registers nn", () => {
    expect(HARDWARE_ONLY_NAMESPACES).toContain("nn");
  });

  it("detects qualified nn operators anywhere in a form", () => {
    expect(usesHardwareOnlyNamespace("(nn/in 1 meml/joy-x)")).toBe(true);
    expect(usesHardwareOnlyNamespace("(let [x (nn/status)] x)")).toBe(true);
  });

  it("does not match bare names, longer namespaces, strings, or comments", () => {
    expect(usesHardwareOnlyNamespace("(nn 1)")).toBe(false);
    expect(usesHardwareOnlyNamespace("(nnn/in 1 value)")).toBe(false);
    expect(usesHardwareOnlyNamespace('(println "nn/status")')).toBe(false);
    expect(usesHardwareOnlyNamespace("; nn/status\n(+ 1 2)")).toBe(false);
  });
});
