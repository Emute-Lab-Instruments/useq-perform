import { expect, test } from "@playwright/test";

import {
  assertFreshBuild,
  bootApp,
  startStaticOriginServer,
  type StaticOriginServer,
} from "./helpers";

type BrowserSynthesisTelemetry = {
  readonly engineState: string;
  readonly audioFrame: bigint;
  readonly peakSample: number;
  readonly finiteOutput: number;
  readonly compiledModuleNames: readonly string[];
  readonly programRevision: number;
  readonly activeEpoch: number;
  readonly pendingEpoch: number;
  readonly instanceId: string;
  readonly ringWriteSequence: number;
  readonly ringReadSequence: number;
  readonly producerLivenessAge: number;
  readonly producerTimeoutActive: boolean;
};

declare global {
  interface Window {
    __useqSynthesisDev?: {
      getTelemetry(): BrowserSynthesisTelemetry;
      terminateProducer(): boolean;
      reinitialise(): Promise<boolean>;
    };
  }
}

test.describe("browser synthesis lifecycle", () => {
  let staticOrigin: StaticOriginServer;

  test.beforeAll(async () => {
    assertFreshBuild();
    staticOrigin = await startStaticOriginServer();
  });

  test.afterAll(async () => {
    await staticOrigin?.close();
  });

  test.beforeEach(async ({ page }) => {
    await bootApp(
      page,
      `${staticOrigin.origin}/?devmode=true&disableWebSerial=true&nosave`,
    );
  });

  test("renders, detects producer loss, and resumes a fresh session", async ({ page }) => {
    expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
    const synthForm = '(synth "osc/sine" :freq 440 :amp 0.2)';
    const editor = page.locator("#panel-main-editor .cm-content");
    await editor.click();
    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");
    await page.keyboard.insertText(synthForm);
    await expect(editor).toHaveText(synthForm);
    await page.keyboard.press("Shift");
    await expect.poll(() => page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry().engineState,
    ), { timeout: 15_000 }).toBe("running");
    expect(await page.evaluate(() => window.__useqBrowserEval!.evalToplevelNow()))
      .toMatchObject({ ok: true, evalAccepted: true });
    await expect(page.locator(".cm-inline-result")).toBeVisible();

    await expect.poll(() => page.evaluate(() => {
      const telemetry = window.__useqSynthesisDev?.getTelemetry();
      return telemetry ? Number(telemetry.audioFrame) : 0;
    }), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const telemetry = window.__useqSynthesisDev?.getTelemetry();
      return telemetry?.peakSample ?? 0;
    }), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry().programRevision ?? 0,
    ), { timeout: 15_000 }).toBeGreaterThan(0);
    const firstSession = await page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry(),
    );
    expect(firstSession).toMatchObject({
      finiteOutput: 1,
      pendingEpoch: 0,
      producerTimeoutActive: false,
    });
    expect(firstSession?.activeEpoch).toBeGreaterThan(0);
    expect(firstSession?.compiledModuleNames).toContain("osc/sine");
    expect(firstSession?.instanceId).not.toBe("");
    expect(firstSession?.ringWriteSequence).toBeGreaterThan(0);
    expect(firstSession?.ringReadSequence).toBeGreaterThan(0);

    expect(await page.evaluate(() =>
      window.__useqSynthesisDev?.terminateProducer() ?? false,
    )).toBe(true);
    await expect.poll(() => page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry().engineState,
    ), { timeout: 15_000 }).toBe("error");
    expect(await page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry().producerTimeoutActive,
    )).toBe(true);

    expect(await page.evaluate(() =>
      window.__useqSynthesisDev?.reinitialise() ?? Promise.resolve(false),
    )).toBe(true);
    await page.keyboard.press("Shift");
    await expect.poll(() => page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry().engineState,
    ), { timeout: 15_000 }).toBe("running");

    const recoveredSession = await page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry(),
    );
    expect(recoveredSession).toMatchObject({
      programRevision: 0,
      activeEpoch: 0,
      pendingEpoch: 0,
      instanceId: "",
    });
    expect(await page.evaluate(() => window.__useqBrowserEval!.evalToplevelNow()))
      .toMatchObject({ ok: true, evalAccepted: true });

    await expect.poll(() => page.evaluate(() => {
      const telemetry = window.__useqSynthesisDev?.getTelemetry();
      return telemetry ? Number(telemetry.audioFrame) : 0;
    }), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => {
      const telemetry = window.__useqSynthesisDev?.getTelemetry();
      return telemetry?.peakSample ?? 0;
    }), { timeout: 15_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry().programRevision ?? 0,
    ), { timeout: 15_000 }).toBeGreaterThan(0);
    const recoveredAudio = await page.evaluate(() =>
      window.__useqSynthesisDev?.getTelemetry(),
    );
    expect(recoveredAudio).toMatchObject({
      finiteOutput: 1,
      pendingEpoch: 0,
      producerTimeoutActive: false,
    });
    expect(recoveredAudio?.activeEpoch).toBeGreaterThan(0);
    expect(recoveredAudio?.instanceId).not.toBe("");
    expect(recoveredAudio?.instanceId).toBe(firstSession?.instanceId);
  });
});
