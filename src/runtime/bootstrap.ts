/**
 * Canonical bootstrap owner.
 *
 * All startup-mode derivation happens here exactly once. The exported
 * `bootstrap()` function is the single public entry point; legacy
 * `main.ts` becomes a thin `DOMContentLoaded` trampoline.
 *
 * Design invariants:
 *   1. `resolveBootstrapPlan` is called at most once per session.
 *   2. `publishRuntimeDiagnostics` is called at most once per session.
 *   3. The plan is threaded *into* `createApp` – the app never
 *      recomputes it.
 */

import { examineEnvironment, type EnvironmentState } from '../legacy/app/environment.ts';
import { createApp } from '../legacy/app/application.ts';
import { createAppUI } from '../legacy/ui/ui.ts';
import { loadConfigurationWithMetadata } from '../legacy/config/configLoader.ts';
import {
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  type RuntimeSettingsSource,
} from './runtimeDiagnostics.ts';
import { resolveBootstrapPlan, type BootstrapPlan } from './bootstrapPlan.ts';
import { bootstrapRuntimeSession } from './runtimeService.ts';
import { appSettingsRepository } from './appSettingsRepository.ts';

// ── Types ──────────────────────────────────────────────────────────

export interface BootstrapResult {
  app: ReturnType<typeof createApp>;
  appUI: Awaited<ReturnType<typeof createAppUI>>;
  environmentState: EnvironmentState;
  bootstrapPlan: BootstrapPlan;
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * Run the full application bootstrap.
 *
 * 1. Load settings (defaults + localStorage + URL overrides).
 * 2. Detect environment capabilities once.
 * 3. Derive the bootstrap plan once.
 * 4. Seed the runtime session store.
 * 5. Publish diagnostics exactly once.
 * 6. Mount the UI and start the app.
 */
export async function bootstrap(): Promise<BootstrapResult> {
  // ── Step 1: load settings ──────────────────────────────────────
  let settingsSources: RuntimeSettingsSource[] = ['defaults'];

  try {
    const result = await loadConfigurationWithMetadata();
    settingsSources = result.settingsSources;
    appSettingsRepository.replaceSettings(result.config, { dispatch: true });
  } catch (error) {
    reportBootstrapFailure('config-loader', error);
    console.warn('bootstrap: failed to load configuration, using defaults:', error);
  }

  // ── Step 2: detect environment ─────────────────────────────────
  const environmentState = examineEnvironment(appSettingsRepository.getSettings());
  const { userSettings, startupFlags } = environmentState;

  // ── Step 3: derive bootstrap plan (single call site) ───────────
  const bootstrapPlan = resolveBootstrapPlan({
    noModuleMode: startupFlags.noModuleMode,
    isWebSerialAvailable: environmentState.isWebSerialAvailable,
    wasmEnabled: userSettings.wasm.enabled,
    startLocallyWithoutHardware: userSettings.runtime.startLocallyWithoutHardware,
  });

  // ── Step 4: seed runtime session ───────────────────────────────
  const runtimeState = bootstrapRuntimeSession(
    {
      hasHardwareConnection: false,
      noModuleMode: startupFlags.noModuleMode,
      wasmEnabled: userSettings.wasm.enabled,
    },
    { connected: false },
  );

  // ── Step 5: publish diagnostics (single call site) ─────────────
  publishRuntimeDiagnostics({
    startupMode: environmentState.areInBrowser
      ? bootstrapPlan.startupMode
      : 'browser-local',
    settingsSources: [...settingsSources],
    activeEnvironment: {
      areInBrowser: environmentState.areInBrowser,
      areInDesktopApp: environmentState.areInDesktopApp,
      isWebSerialAvailable: environmentState.isWebSerialAvailable,
      isInDevmode: environmentState.isInDevmode,
      urlParams: environmentState.urlParams,
    },
    protocolMode: runtimeState.protocolMode,
    runtimeSession: runtimeState.session,
  });

  // ── Step 6: mount UI + start app ───────────────────────────────
  const appUI = await createAppUI(environmentState);
  const app = createApp(appUI, environmentState, bootstrapPlan);
  await app.start();

  return { app, appUI, environmentState, bootstrapPlan };
}
