import { post } from '../utils/consoleStore.ts';
import { dbg, toggleDbg } from "./utils.ts";
import type { StartupFlags } from "../runtime/startupContext.ts";

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
