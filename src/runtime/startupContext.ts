export interface StartupFlags {
  debug: boolean;
  devmode: boolean;
  disableWebSerial: boolean;
  noModuleMode: boolean;
  nosave: boolean;
  params: Record<string, string>;
}

export interface EnvironmentCapabilities {
  areInBrowser: boolean;
  areInDesktopApp: boolean;
  isWebSerialAvailable: boolean;
}

const DEFAULT_STARTUP_FLAGS: StartupFlags = {
  debug: false,
  devmode: false,
  disableWebSerial: false,
  noModuleMode: false,
  nosave: false,
  params: {},
};

const DEFAULT_ENVIRONMENT_CAPABILITIES: EnvironmentCapabilities = {
  areInBrowser: false,
  areInDesktopApp: false,
  isWebSerialAvailable: false,
};

let currentStartupFlags: StartupFlags = {
  ...DEFAULT_STARTUP_FLAGS,
  params: { ...DEFAULT_STARTUP_FLAGS.params },
};

let currentEnvironmentCapabilities: EnvironmentCapabilities = {
  ...DEFAULT_ENVIRONMENT_CAPABILITIES,
};

function cloneStartupFlags(flags: StartupFlags): StartupFlags {
  return {
    ...flags,
    params: { ...flags.params },
  };
}

export function setStartupFlags(flags: StartupFlags): StartupFlags {
  currentStartupFlags = cloneStartupFlags(flags);
  return getStartupFlagsSnapshot();
}

export function getStartupFlagsSnapshot(): StartupFlags {
  return cloneStartupFlags(currentStartupFlags);
}

export function setEnvironmentCapabilities(
  capabilities: EnvironmentCapabilities,
): EnvironmentCapabilities {
  currentEnvironmentCapabilities = { ...capabilities };
  return getEnvironmentCapabilitiesSnapshot();
}

export function getEnvironmentCapabilitiesSnapshot(): EnvironmentCapabilities {
  return { ...currentEnvironmentCapabilities };
}

export function applyStartupContext(input: {
  startupFlags: StartupFlags;
  capabilities: EnvironmentCapabilities;
}): void {
  setStartupFlags(input.startupFlags);
  setEnvironmentCapabilities(input.capabilities);
}

export function isLocalStorageBypassedInStartupContext(): boolean {
  return currentStartupFlags.nosave;
}

export function resetStartupContextForTests(): void {
  currentStartupFlags = cloneStartupFlags(DEFAULT_STARTUP_FLAGS);
  currentEnvironmentCapabilities = { ...DEFAULT_ENVIRONMENT_CAPABILITIES };
}

// ── Environment examination ─────────────────────────────────────────
// Merged from legacy/app/environment.ts

import { getStartupFlags } from './urlParams.ts';
import type { AppSettings } from '../lib/appSettings.ts';

export interface EnvironmentState extends EnvironmentCapabilities {
  isInDevmode: boolean;
  startupFlags: StartupFlags;
  userSettings: AppSettings;
  urlParams: Record<string, string>;
}

export async function examineEnvironment(
  userSettings: AppSettings,
): Promise<EnvironmentState> {
  const startupFlags = getStartupFlags();

  // Desktop/Electron runtime support is out of scope for the reset.
  const areInBrowser = typeof window !== 'undefined' && window.navigator;
  const areInDesktopApp = false;

  // Check for Web Serial API support (can be disabled via URL parameter).
  // checkForWebserialSupport is imported lazily to avoid a circular
  // dependency: connector.ts → appSettingsRepository.ts → configSchema.ts
  // → appSettings.ts → startupContext.ts.
  let isWebSerialAvailable = false;
  if (!startupFlags.disableWebSerial) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { checkForWebserialSupport } = await import('../transport/connector.ts');
    isWebSerialAvailable = checkForWebserialSupport();
  }

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
