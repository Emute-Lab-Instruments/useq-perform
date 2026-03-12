import './styles/index.css';
import { createAppUI } from './ui/ui.ts';
import { examineEnvironment } from './app/environment.ts';
import { createApp } from './app/application.ts';
import { loadConfigurationWithMetadata } from './config/configLoader.ts';
import { activeUserSettings, replaceUserSettings } from './utils/persistentUserSettings.ts';
import { noModuleMode } from './urlParams.ts';
import { createRuntimeSessionSnapshot } from '../runtime/runtimeSession.ts';
import {
  publishRuntimeDiagnostics,
  reportBootstrapFailure,
  resolveStartupMode,
  type RuntimeSettingsSource,
} from '../runtime/runtimeDiagnostics.ts';

export async function startLegacyApp() {
  let settingsSources: RuntimeSettingsSource[] = ['defaults'];

  // Load configuration from hardcoded defaults + default-config.json + localStorage + URL params.
  try {
    const result = await loadConfigurationWithMetadata();
    settingsSources = result.settingsSources;
    const config = result.config;
    replaceUserSettings(config, { dispatch: true });
  } catch (error) {
    reportBootstrapFailure('config-loader', error);
    console.warn('Failed to load configuration, using defaults:', error);
  }

  let environmentState = examineEnvironment();
  publishRuntimeDiagnostics({
    startupMode: resolveStartupMode({
      areInBrowser: environmentState.areInBrowser,
      isWebSerialAvailable: environmentState.isWebSerialAvailable,
      noModuleMode,
      startLocallyWithoutHardware:
        activeUserSettings?.runtime?.startLocallyWithoutHardware !== false,
    }),
    settingsSources: [...settingsSources],
    activeEnvironment: {
      areInBrowser: environmentState.areInBrowser,
      areInDesktopApp: environmentState.areInDesktopApp,
      isWebSerialAvailable: environmentState.isWebSerialAvailable,
      isInDevmode: environmentState.isInDevmode,
      urlParams: environmentState.urlParams,
    },
    runtimeSession: createRuntimeSessionSnapshot({
      hasHardwareConnection: false,
      noModuleMode,
      wasmEnabled: activeUserSettings?.wasm?.enabled ?? true,
    }),
  });
  let appUI = await createAppUI(environmentState);
  let app = createApp(appUI, environmentState);
  await app.start();
  return { app, appUI, environmentState };
}

// Main entry point
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    void startLegacyApp();
  });
}
