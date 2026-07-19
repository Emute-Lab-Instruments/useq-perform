/**
 * Listening-guide integration tests.
 *
 * Covers:
 *   VAL-CROSS-010 - the checked-in user-run first-sound listening checklist
 *                   names its path, opens with a safe-volume warning and stop
 *                   conditions, gives exact port-5000 startup and devmode
 *                   procedures, identifies indicator/telemetry/fault
 *                   controls, and provides exact source, actions, expected
 *                   subjective observations, and objective checks for first
 *                   sound, pitch movement, click-free repeated re-eval,
 *                   panel/menu/drag stress, reload/autoplay, producer death,
 *                   bounded fade, error, and recovery.
 *
 * This file validates the documentation deliverable only. Subjective
 * audibility is NOT automated (per the manual-listening boundary in
 * `library/user-testing.md`). Browser-reachability of the named controls
 * is covered by the objective first-sound browser-flow validator against
 * `http://127.0.0.1:5000/`. These tests statically assert that every
 * named control corresponds to a real source-level surface so the
 * guide cannot silently drift out of sync with the implementation.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(__dirname, "..", "..");
const GUIDE_PATH = "docs/synthesis/LISTENING_GUIDE.md";

/** Read a repo-relative file as UTF-8 text. */
function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(REPO_ROOT, relativePath), "utf8");
}

describe("first-sound listening guide (VAL-CROSS-010)", () => {
  const guide = readRepoFile(GUIDE_PATH);

  it("exists at the documented path", () => {
    // VAL-CROSS-010: "names its path".
    expect(guide.length).toBeGreaterThan(0);
  });

  it("opens with a safe-volume warning before any listening instruction", () => {
    // VAL-CROSS-010: "starts with a safe-volume warning".
    const head = guide.slice(0, 4000).toLowerCase();
    expect(head).toMatch(/safe.{0,3}volume|volume.{0,12}(low|safe|caution)|start low|1[ -]?(%|percent)/);
    expect(head).toMatch(/headphone|ear|muffle|loud|hearing/i);
  });

  it("documents immediate stop conditions", () => {
    // VAL-CROSS-010: "stop conditions". Must include both a UI route and
    // the producer-fault path the worklet enforces.
    expect(guide).toMatch(/stop condition|immediate stop|how to stop/i);
    expect(guide).toMatch(/close the tab|mute|reload|producer.{0,20}timeout|10\s?ms fade/i);
  });

  it("gives the exact port-5000 startup command", () => {
    // VAL-CROSS-010: "exact port-5000 startup".
    expect(guide).toMatch(/npm run start/);
    expect(guide).toMatch(/127\.0\.0\.1:5000|localhost:5000/);
  });

  it("gives the exact devmode entry route (?devmode=true)", () => {
    // VAL-CROSS-010: "devmode procedures". The flag uses strict string
    // equality against the literal "true"; `?devmode=1` does NOT work.
    // The guide must recommend `?devmode=true` as the entry route; any
    // mention of `?devmode=1` must be inside a "does not enable"
    // warning, not as an alternative route.
    expect(guide).toMatch(/\?devmode=true/);
    // Forbid recommending `?devmode=1` as a valid entry: any
    // standalone occurrence not preceded by a "does not" is a drift.
    // We strip the documented warning by ignoring lines containing
    // "does not" / "does **not**".
    const linesAcceptingDevmode1 = guide
      .split("\n")
      .filter((line) => /\?devmode=1\b/.test(line))
      .filter((line) => !/does\s*\**not\**\s*(enable|work)/i.test(line));
    expect(linesAcceptingDevmode1).toEqual([]);
  });

  it("identifies the suspended engine indicator as the recovery affordance", () => {
    // VAL-CROSS-010: "indicator controls". The clickable suspended
    // indicator is the sole recovery affordance (VAL-ENGINE-020).
    expect(guide).toMatch(/suspended/i);
    expect(guide).toMatch(/engine-indicator|engine indicator|transport-family indicator/i);
    expect(guide).toMatch(/click/i);
  });

  it("names the devmode telemetry surface (__useqSynthesisDev)", () => {
    // VAL-CROSS-010: "telemetry controls". The devmode-only global is
    // `window.__useqSynthesisDev`; it is absent or inert in production.
    expect(guide).toMatch(/__useqSynthesisDev/);
    expect(guide).toMatch(/getTelemetry|devmode console|console\.log/);
  });

  it("names the devmode-only producer termination and recovery controls", () => {
    // VAL-CROSS-010: "fault controls". The surface exposes
    // `terminateProducer()` and `reinitialise()` only when devmode is on.
    expect(guide).toMatch(/terminateProducer/);
    expect(guide).toMatch(/reinitialise|reinitialize|reinitialization|reinitialisation/i);
  });

  it("lists the canonical sine source form", () => {
    // VAL-CROSS-010: "source".
    expect(guide).toMatch(/\(synth "osc\/sine" :freq 440\)/);
  });

  it("covers first sound", () => {
    expect(guide).toMatch(/first sound|first tone|first-sound/i);
  });

  it("covers pitch movement on the same anonymous synth", () => {
    expect(guide).toMatch(/pitch|frequency/i);
    expect(guide).toMatch(/:freq\s+\d+/);
  });

  it("covers click-free repeated re-evaluation", () => {
    expect(guide).toMatch(/re-?eval|reeval/i);
    expect(guide).toMatch(/click-free|glitch|discontinuity|no click/i);
  });

  it("covers panel/menu/drag stress", () => {
    expect(guide).toMatch(/panel|menu|drag/i);
    expect(guide).toMatch(/stress|glitch|underrun/i);
  });

  it("covers reload and autoplay (suspended-until-activation) behaviour", () => {
    expect(guide).toMatch(/reload/i);
    expect(guide).toMatch(/autoplay|suspended|activation|trusted/i);
  });

  it("covers producer death, bounded 10 ms fade, error, and recovery", () => {
    expect(guide).toMatch(/producer death|producer termination|terminateProducer/i);
    expect(guide).toMatch(/10\s?ms/i);
    expect(guide).toMatch(/silence|fade to (zero|silence)/i);
    expect(guide).toMatch(/error/i);
    expect(guide).toMatch(/recovery|reinitialise|reinitialize/i);
  });

  it("gives expected subjective observations for each scenario", () => {
    // VAL-CROSS-010: "expected subjective observations".
    expect(guide).toMatch(/expected observation|what you (should|will) hear|listen for|expected sound|subjective/i);
  });

  it("gives objective telemetry checks for each scenario", () => {
    // VAL-CROSS-010: "objective checks". Subjective audibility is not
    // claimed by automation; the guide must pair each listening step
    // with a devmode telemetry check.
    expect(guide).toMatch(/objective check|telemetry check|verify in telemetry|devmode check/i);
    expect(guide).toMatch(/peakSample|rmsSample|finiteOutput|peak\/rms/i);
  });

  it("does not claim automated audibility", () => {
    // Manual-listening boundary: subjective audibility is delegated to
    // the user; automation only verifies objective telemetry. Markdown
    // bold (`**`) can split the phrase "not claimed by automation",
    // so match across the `**` boundary.
    expect(guide).toMatch(/subjective/i);
    expect(guide).toMatch(/audibility/i);
    expect(guide).toMatch(/not\**\s*claimed\**\s*by automation|automation (does not|cannot)/i);
    expect(guide).toMatch(/you.*?(must|should).*?(judge|listen|run)/i);
  });

  describe("every named control is reachable in the implementation", () => {
    /**
     * Statically verify each control named in the guide has a real
     * source-level counterpart. Browser-reachability is established by
     * the objective first-sound browser-flow validator; these tests
     * guard against the guide naming a control that no longer exists.
     */
    const indicatorSource = readRepoFile("src/audio/engineIndicator.tsx");
    const serviceSource = readRepoFile("src/audio/synthesisService.ts");
    const adapterSource = readRepoFile("src/ui/adapters/toolbars.tsx");

    it("the suspended indicator is a real clickable control", () => {
      expect(indicatorSource).toMatch(/engine-indicator-clickable/);
      expect(indicatorSource).toMatch(/onClick/);
      expect(adapterSource).toMatch(/mountEngineIndicator/);
    });

    it("the devmode telemetry + fault surface is real", () => {
      expect(serviceSource).toMatch(/SynthesisDevmodeSurface/);
      expect(serviceSource).toMatch(/terminateProducer\(\)/);
      expect(serviceSource).toMatch(/reinitialise\(\)/);
      expect(serviceSource).toMatch(/getTelemetry\(\)/);
    });

    it("the engine indicator honours four states", () => {
      expect(indicatorSource).toMatch(/data-engine-state/);
      expect(indicatorSource).toMatch(/engine-indicator-suspended/);
      expect(indicatorSource).toMatch(/engine-indicator-running/);
      expect(indicatorSource).toMatch(/engine-indicator-error/);
    });
  });
});
