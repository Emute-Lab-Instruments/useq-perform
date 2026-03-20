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

// ── URL parameter parsing ───────────────────────────────────────────
// Merged from urlParams.ts

import { post } from '../utils/consoleStore.ts';
import { dbg, toggleDbg } from '../lib/debug.ts';

let appliedStartupFlagsKey: string | null = null;

function isEnabledParam(value: string | null): boolean {
  return value === "true";
}

function resolveSearch(search?: string): string {
  if (typeof search === "string") {
    return search;
  }

  if (typeof window !== "undefined" && typeof window.location?.search === "string") {
    return window.location.search;
  }

  return "";
}

export function readStartupFlags(search?: string): StartupFlags {
  const urlParams = new URLSearchParams(resolveSearch(search));
  const params = Object.fromEntries(urlParams.entries());

  dbg("URL Parameters: ", urlParams);

  return {
    debug: isEnabledParam(urlParams.get("debug")),
    devmode: isEnabledParam(urlParams.get("devmode")),
    disableWebSerial: isEnabledParam(urlParams.get("disableWebSerial")),
    noModuleMode: isEnabledParam(urlParams.get("noModuleMode")),
    nosave: urlParams.has("nosave"),
    params,
  };
}

export function applyStartupFlags(flags: StartupFlags): StartupFlags {
  const key = JSON.stringify(flags.params);
  if (appliedStartupFlagsKey === key) {
    return flags;
  }

  appliedStartupFlagsKey = key;

  if (flags.debug) {
    toggleDbg();
    dbg("Debug mode enabled");
  }

  if (flags.devmode) {
    dbg("Dev mode enabled");
  }

  if (flags.disableWebSerial) {
    dbg("WebSerial disabled via URL parameter");
  }

  if (flags.noModuleMode) {
    dbg("No-module mode enabled");
    post("**Info**: Running in no-module mode. Expressions evaluate via the in-browser uSEQ interpreter.");
  }

  return flags;
}

export function getStartupFlags(search?: string): StartupFlags {
  return applyStartupFlags(readStartupFlags(search));
}

export function resetStartupFlagsForTests(): void {
  appliedStartupFlagsKey = null;
}

// ── Environment examination ─────────────────────────────────────────
// Merged from legacy/app/environment.ts

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
  // dependency: connector.ts → appSettingsRepository.ts → normalization.ts
  // → appSettings.ts → startupContext.ts.
  let isWebSerialAvailable = false;
  if (!startupFlags.disableWebSerial) {
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
