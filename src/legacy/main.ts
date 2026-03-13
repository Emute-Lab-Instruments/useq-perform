import './styles/index.css';
import { createAppUI } from './ui/ui.ts';
import { examineEnvironment } from './app/environment.ts';
import { createApp } from './app/application.ts';
import { loadConfigurationWithMetadata } from './config/configLoader.ts';
import {
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  type RuntimeSettingsSource,
} from '../runtime/runtimeDiagnostics.ts';
import { resolveBootstrapPlan } from '../runtime/bootstrapPlan.ts';
import { bootstrapRuntimeSession } from '../runtime/runtimeService.ts';
import { appSettingsRepository } from '../runtime/appSettingsRepository.ts';

export async function startLegacyApp() {
  let settingsSources: RuntimeSettingsSource[] = ['defaults'];
  let environmentState = examineEnvironment();

  // Load configuration from hardcoded defaults + default-config.json + localStorage + URL params.
  try {
    const result = await loadConfigurationWithMetadata();
    settingsSources = result.settingsSources;
    appSettingsRepository.replaceSettings(result.config, { dispatch: true });
  } catch (error) {
    reportBootstrapFailure('config-loader', error);
    console.warn('Failed to load configuration, using defaults:', error);
  }

  environmentState = examineEnvironment(appSettingsRepository.getSettings());
  const userSettings = environmentState.userSettings;
  const bootstrapPlan = resolveBootstrapPlan({
    noModuleMode: environmentState.startupFlags.noModuleMode,
    isWebSerialAvailable: environmentState.isWebSerialAvailable,
    wasmEnabled: userSettings.wasm.enabled,
    startLocallyWithoutHardware: userSettings.runtime.startLocallyWithoutHardware,
  });
  const runtimeState = bootstrapRuntimeSession(
    {
      hasHardwareConnection: false,
      noModuleMode: environmentState.startupFlags.noModuleMode,
      wasmEnabled: userSettings.wasm.enabled,
    },
    {
      connected: false,
    }
  );
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
  let appUI = await createAppUI(environmentState);
  let app = createApp(appUI, environmentState, bootstrapPlan);
  await app.start();
  return { app, appUI, environmentState };
}

// Main entry point
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void startLegacyApp();
  });
}
