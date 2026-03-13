import { checkForWebserialSupport } from '../io/serialComms.ts';
import { getStartupFlags } from '../urlParams.ts';
import { getAppSettings } from '../../runtime/appSettingsRepository.ts';
import {
  applyStartupContext,
  type EnvironmentCapabilities,
  type StartupFlags,
} from '../../runtime/startupContext.ts';
import type { AppSettings } from '../config/appSettings.ts';

export interface EnvironmentState extends EnvironmentCapabilities {
  isInDevmode: boolean;
  startupFlags: StartupFlags;
  userSettings: AppSettings;
  urlParams: Record<string, string>;
}

export function examineEnvironment(
  userSettings: AppSettings = getAppSettings(),
): EnvironmentState {
  const startupFlags = getStartupFlags();

  // Desktop/Electron runtime support is out of scope for the reset.
  const areInBrowser = typeof window !== 'undefined' && window.navigator;
  const areInDesktopApp = false;

  // Check for Web Serial API support (can be disabled via URL parameter)
  const isWebSerialAvailable = startupFlags.disableWebSerial
    ? false
    : checkForWebserialSupport();

  applyStartupContext({
    startupFlags,
    capabilities: {
      areInBrowser,
      areInDesktopApp,
      isWebSerialAvailable,
    },
  });

  return {
    areInBrowser,
    areInDesktopApp,
    isWebSerialAvailable,
    isInDevmode: startupFlags.devmode,
    startupFlags,
    userSettings,
    urlParams: startupFlags.params,
  };
}
