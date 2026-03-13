export type BootstrapStartupMode =
  | "hardware"
  | "browser-local"
  | "no-module"
  | "unsupported-browser";

export interface BootstrapPlanInput {
  noModuleMode: boolean;
  isWebSerialAvailable: boolean;
  wasmEnabled: boolean;
  startLocallyWithoutHardware: boolean;
}

export interface BootstrapPlan {
  startupMode: BootstrapStartupMode;
  startBrowserLocal: boolean;
  seedDefaultNoModuleExpressions: boolean;
  attemptHardwareReconnect: boolean;
  showUnsupportedBrowserWarning: boolean;
}

export function resolveBootstrapPlan(
  input: BootstrapPlanInput,
): BootstrapPlan {
  if (input.noModuleMode) {
    return {
      startupMode: "no-module",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: true,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: false,
    };
  }

  if (!input.isWebSerialAvailable) {
    return {
      startupMode: input.wasmEnabled ? "browser-local" : "unsupported-browser",
      startBrowserLocal: input.wasmEnabled,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: false,
      showUnsupportedBrowserWarning: !input.wasmEnabled,
    };
  }

  if (input.wasmEnabled && input.startLocallyWithoutHardware) {
    return {
      startupMode: "browser-local",
      startBrowserLocal: true,
      seedDefaultNoModuleExpressions: false,
      attemptHardwareReconnect: true,
      showUnsupportedBrowserWarning: false,
    };
  }

  return {
    startupMode: "hardware",
    startBrowserLocal: false,
    seedDefaultNoModuleExpressions: false,
    attemptHardwareReconnect: true,
    showUnsupportedBrowserWarning: false,
  };
}
