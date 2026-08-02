/**
 * Chapter 0 — "How uSEQ Thinks" data-shape tests.
 * Spec: docs/specs/the-machine.md §3, §5.1, §6.2.
 */

import { describe, expect, it } from "vitest";

import { chapter0 } from "./ch0-machine";
import { chapters } from "../guideData";
import { MACHINE_IDEAS } from "../../machine/machineModel";
import { LINKED_GUIDE_SECTION_IDS } from "../../../../lib/diagnosticGuideLinks";
import type { ContentBlock } from "../guideTypes";

function blockTypes(content: readonly ContentBlock[]): string[] {
  return content.map((b) => b.type);
}

describe("chapter 0 — placement (§3.1)", () => {
  it("is the first chapter, in the Language domain", () => {
    expect(chapters[0]).toBe(chapter0);
    expect(chapter0.domain).toBe("language");
  });

  it("leaves the existing chapters in place after it", () => {
    expect(chapters.map((c) => c.id)).toEqual([
      "machine",
      "language",
      "algebra",
      "modulation",
      "rhythm",
      "editor",
    ]);
  });

  it("opens with the live schematic (§2.4)", () => {
    expect(chapter0.intro).toBeDefined();
    expect(chapter0.intro![0].type).toBe("machine");
  });
});

describe("chapter 0 — the six ideas (§3.1)", () => {
  it("has one section per idea, in ordinal order", () => {
    expect(chapter0.sections).toHaveLength(6);
    expect(chapter0.sections.map((s) => s.id)).toEqual(
      MACHINE_IDEAS.map((i) => i.sectionId),
    );
  });

  it("gives every section a title, a summary and content", () => {
    for (const section of chapter0.sections) {
      expect(section.title.length).toBeGreaterThan(0);
      expect(section.summary.length).toBeGreaterThan(0);
      expect(section.content.length).toBeGreaterThan(0);
    }
  });

  it("gives every section a paragraph, a playground and a try-it prompt", () => {
    for (const section of chapter0.sections) {
      const types = blockTypes(section.content);
      expect(types, `${section.id} prose`).toContain("prose");
      expect(types, `${section.id} playground`).toContain("playground");
      expect(types, `${section.id} try-it`).toContain("try-it");
    }
  });

  it("shares the schematic's playground for each idea, so the two cannot drift", () => {
    for (const idea of MACHINE_IDEAS) {
      const section = chapter0.sections.find((s) => s.id === idea.sectionId)!;
      const playgrounds = section.content.filter(
        (b): b is Extract<ContentBlock, { type: "playground" }> =>
          b.type === "playground",
      );
      expect(playgrounds[0].playground).toBe(idea.playground);
    }
  });

  it("probes its playgrounds live rather than showing static waveforms", () => {
    for (const idea of MACHINE_IDEAS) {
      expect(idea.playground.outputs?.length ?? 0).toBeGreaterThan(0);
    }
  });

  it("puts intermediate material in deep-dive collapsibles (§3.4)", () => {
    const withDeepDive = chapter0.sections.filter((s) =>
      blockTypes(s.content).includes("deep-dive"),
    );
    expect(withDeepDive.length).toBeGreaterThanOrEqual(3);
    // §3.4's worked example: the fast / rate-as distinction, in user language.
    const warps = chapter0.sections.find((s) => s.id === "machine-warps")!;
    const deepDives = warps.content.filter(
      (b): b is Extract<ContentBlock, { type: "deep-dive" }> =>
        b.type === "deep-dive",
    );
    const text = JSON.stringify(deepDives);
    expect(text).toContain("rate-as");
  });
});

describe("chapter 0 — the two demonstrative sections", () => {
  it("idea 4 sends the reader to the probe depth control (§3.2)", () => {
    const warps = chapter0.sections.find((s) => s.id === "machine-warps")!;
    const tryIt = warps.content.find((b) => b.type === "try-it");
    expect(tryIt).toBeDefined();
    expect((tryIt as { text: string }).text).toMatch(/depth/i);
  });

  it("idea 6 is the break-it LKG demonstration (§3.3)", () => {
    const failure = chapter0.sections.find((s) => s.id === "machine-failure")!;
    const playgrounds = failure.content.filter(
      (b): b is Extract<ContentBlock, { type: "playground" }> =>
        b.type === "playground",
    );
    // Preloaded working code first, then the broken version to evaluate.
    expect(playgrounds).toHaveLength(2);
    expect(playgrounds[0].playground.code).toBe("(a1 0.75)");
    expect(playgrounds[1].playground.code).toContain("no-such");

    const tryIt = failure.content.find((b) => b.type === "try-it");
    expect((tryIt as { text: string }).text).toMatch(/break it/i);

    // Both halves are corpus-backed.
    expect(playgrounds[0].playground.witnessRef).toBe(
      "compile-error-keeps-active-program",
    );
    expect(playgrounds[1].playground.witnessRef).toBe(
      "successful-eval-replaces-program",
    );
  });
});

describe("diagnostics deep-link map (§5.1)", () => {
  it("only points at guide sections that actually exist", () => {
    const allSectionIds = new Set(
      chapters.flatMap((c) => c.sections.map((s) => s.id)),
    );
    for (const sectionId of LINKED_GUIDE_SECTION_IDS) {
      expect(allSectionIds.has(sectionId), `unknown section ${sectionId}`).toBe(
        true,
      );
    }
  });
});
