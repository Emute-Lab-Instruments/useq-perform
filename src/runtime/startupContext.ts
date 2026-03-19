export interface StartupFlags {
  readonly debug: boolean;
  readonly devmode: boolean;
  readonly disableWebSerial: boolean;
  readonly noModuleMode: boolean;
  readonly nosave: boolean;
  readonly params: Readonly<Record<string, string>>;
}

export interface EnvironmentCapabilities {
  readonly areInBrowser: boolean;
  readonly areInDesktopApp: boolean;
  readonly isWebSerialAvailable: boolean;
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

/** True once applyStartupContext() has been called. */
let frozen = false;

function assertNotFrozen(caller: string): void {
  if (frozen) {
    throw new Error(
      `startupContext is frozen: ${caller}() cannot be called after bootstrap`,
    );
  }
}

function cloneStartupFlags(flags: StartupFlags): StartupFlags {
  return {
    ...flags,
    params: { ...flags.params },
  };
}

export function setStartupFlags(flags: StartupFlags): StartupFlags {
  assertNotFrozen("setStartupFlags");
  currentStartupFlags = cloneStartupFlags(flags);
  return getStartupFlagsSnapshot();
}

export function getStartupFlagsSnapshot(): StartupFlags {
  return cloneStartupFlags(currentStartupFlags);
}

export function setEnvironmentCapabilities(
  capabilities: EnvironmentCapabilities,
): EnvironmentCapabilities {
  assertNotFrozen("setEnvironmentCapabilities");
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
  assertNotFrozen("applyStartupContext");
  currentStartupFlags = Object.freeze(cloneStartupFlags(input.startupFlags));
  currentEnvironmentCapabilities = Object.freeze({ ...input.capabilities });
  frozen = true;
}

export function isStartupContextFrozen(): boolean {
  return frozen;
}

export function isLocalStorageBypassedInStartupContext(): boolean {
  return currentStartupFlags.nosave;
}

/**
 * Test-only: temporarily unfreeze the context, run a callback, then re-freeze.
 * Replaces the old `resetStartupContextForTests()` pattern.
 */
export function withStartupContextOverride<T>(
  override: {
    startupFlags?: Partial<StartupFlags>;
    capabilities?: Partial<EnvironmentCapabilities>;
  },
  fn: () => T,
): T {
  const prevFlags = currentStartupFlags;
  const prevCaps = currentEnvironmentCapabilities;
  const wasFrozen = frozen;

  frozen = false;
  currentStartupFlags = Object.freeze(
    cloneStartupFlags({
      ...DEFAULT_STARTUP_FLAGS,
      ...override.startupFlags,
      params: {
        ...DEFAULT_STARTUP_FLAGS.params,
        ...(override.startupFlags?.params ?? {}),
      },
    }),
  );
  currentEnvironmentCapabilities = Object.freeze({
    ...DEFAULT_ENVIRONMENT_CAPABILITIES,
    ...override.capabilities,
  });
  frozen = true;

  try {
    return fn();
  } finally {
    currentStartupFlags = prevFlags;
    currentEnvironmentCapabilities = prevCaps;
    frozen = wasFrozen;
  }
}

/**
 * Test-only: reset the context to defaults and unfreeze it so
 * setStartupFlags / applyStartupContext can be called again.
 */
export function resetStartupContextForTests(): void {
  frozen = false;
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
  urlParams: Readonly<Record<string, string>>;
}

export async function examineEnvironment(
  userSettings: AppSettings,
): Promise<EnvironmentState> {
  const startupFlags = getStartupFlags();

  // Desktop/Electron runtime support is out of scope for the reset.
  const areInBrowser = typeof window !== 'undefined' && !!window.navigator;
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
