import { protocolReady } from "../contracts/runtimeChannels.ts";
import type { ConfirmPromptFn } from "./hardwareConnectPrompt.ts";
import {
  FIRMWARE_BETA_LANDING_PATH,
  artifactForTarget,
  fetchFirmwareManifest,
  shouldOfferFirmwareUpdate,
  type FirmwareReleaseManifest,
} from "../firmware/firmwareManifest.ts";
import { enterBootloaderMode } from "../transport/connector.ts";
import { getConnectedFirmwareIdentity } from "../transport/json-protocol.ts";
import type { ConnectedFirmwareIdentity } from "../transport/types.ts";
import { post } from "../utils/consoleStore.ts";
import { getSettings, updateSettings } from "../runtime/runtimeService.ts";

export interface FirmwareUpdateOffer {
  title: string;
  message: string;
  confirmLabel: string;
}

export interface ExpanderFirmwareUpdateOffer extends FirmwareUpdateOffer {
  target: string;
  manualReset: true;
}

export function firmwareChannelEnabled(
  channel: FirmwareReleaseManifest["channel"],
  betaUpdates: boolean | undefined,
): boolean {
  return channel !== "beta" || betaUpdates !== false;
}

export function buildFirmwareUpdateOffer(
  identity: ConnectedFirmwareIdentity,
  manifest: FirmwareReleaseManifest,
): FirmwareUpdateOffer | null {
  if (!shouldOfferFirmwareUpdate(identity.firmwareVersion, manifest)) return null;
  const artifact = artifactForTarget(manifest, identity.hardwareTarget);
  if (identity.hardwareTarget && !artifact) return null;

  const installed = identity.firmwareVersion
    ? `v${identity.firmwareVersion}`
    : "an older firmware build";
  const targetText = artifact
    ? `The verified ${artifact.label} file will be selected for you.`
    : "The updater will ask which hardware variant you own before it enables a download.";
  return {
    title: manifest.channel === "beta"
      ? "uSEQ firmware beta available"
      : "uSEQ firmware update available",
    message:
      `This module is running ${installed}. ` +
      `Firmware v${manifest.version} is available on the ${manifest.channel} channel. ` +
      `${targetText} Your program stays saved in the editor.`,
    confirmLabel: "Open update",
  };
}

export function buildExpanderFirmwareUpdateOffer(
  identity: ConnectedFirmwareIdentity,
  manifest: FirmwareReleaseManifest,
): ExpanderFirmwareUpdateOffer | null {
  for (const module of identity.modules) {
    if (
      module.kind !== "output-expander" ||
      module.identityStatus !== "verified" ||
      !module.target ||
      !module.firmware ||
      !shouldOfferFirmwareUpdate(module.firmware, manifest) ||
      !artifactForTarget(manifest, module.target)
    ) continue;

    const unit = module.serial ? `expander ${module.serial}` : "connected expander";
    const directConnection = module.updateTransport === "usb"
      ? "Connect its panel USB port directly to this computer before entering update mode."
      : "This pre-production expander has no panel USB port; access its board USB/BOOTSEL connection to update it.";
    return {
      title: manifest.channel === "beta"
        ? "Expander firmware beta available"
        : "Expander firmware update available",
      message:
        `The ${unit} is running v${module.firmware}; v${manifest.version} is available. ` +
        `${directConnection} The main module cannot relay firmware over I²C.`,
      confirmLabel: "Open expander update",
      target: module.target,
      manualReset: true,
    };
  }
  return null;
}

let unsubscribe: (() => void) | null = null;
let offeredKey: string | null = null;
let updateChannel: BroadcastChannel | null = null;

export function initFirmwareUpdatePrompt(
  showConfirm: ConfirmPromptFn,
  dependencies: {
    loadManifest?: typeof fetchFirmwareManifest;
    openGuide?: (target: string | null, manualReset?: boolean) => void;
    enterBootloader?: () => Promise<boolean>;
  } = {},
): void {
  if (unsubscribe) return;
  const loadManifest = dependencies.loadManifest ?? fetchFirmwareManifest;
  const openGuide = dependencies.openGuide ?? ((target: string | null, manualReset = false) => {
    const params = new URLSearchParams();
    if (target) params.set("target", target);
    if (manualReset) params.set("manual", "1");
    const suffix = params.size > 0 ? `?${params}` : "";
    window.open(`${FIRMWARE_BETA_LANDING_PATH}${suffix}`, "_blank", "noopener");
  });
  const enterBootloader = dependencies.enterBootloader ?? (() => enterBootloaderMode());

  if (typeof BroadcastChannel !== "undefined") {
    updateChannel = new BroadcastChannel("useq-firmware-update-v1");
    updateChannel.addEventListener("message", (event: MessageEvent<unknown>) => {
      if (!event.data || typeof event.data !== "object") return;
      const message = event.data as { type?: string };
      if (message.type !== "prepare-bootloader") return;
      void enterBootloader().then((entered) => {
        updateChannel?.postMessage({ type: "bootloader-result", entered });
      });
    });
  }

  unsubscribe = protocolReady.subscribe(() => {
    const identity = getConnectedFirmwareIdentity();
    if (!identity.firmwareVersion) return;

    void loadManifest().then((manifest) => {
      if (!manifest) return;
      if (!firmwareChannelEnabled(
        manifest.channel,
        getSettings().runtime?.firmwareBetaUpdates,
      )) return;
      const mainOffer = buildFirmwareUpdateOffer(identity, manifest);
      const expanderOffer = buildExpanderFirmwareUpdateOffer(identity, manifest);
      const offer = mainOffer ?? expanderOffer;
      if (!offer) return;
      const guideTarget = mainOffer ? identity.hardwareTarget : expanderOffer?.target ?? null;
      const manualReset = !mainOffer && expanderOffer?.manualReset === true;
      const key = [identity.firmwareVersion, identity.hardwareTarget, guideTarget, manifest.version].join(":");
      if (key === offeredKey) return;
      offeredKey = key;

      showConfirm({
        id: "firmware-beta-update",
        ...offer,
        cancelLabel: "Not now",
        ...(manifest.channel === "beta" ? {
          secondaryLabel: "Stop showing betas",
          onSecondary: () => {
            updateSettings({ runtime: { firmwareBetaUpdates: false } });
            post("Beta firmware offers are off. You can turn them back on in Advanced Settings.");
          },
        } : {}),
        onConfirm: () => {
          // The guide caches and verifies the UF2 before it asks the editor to
          // reboot the module. Keeping the serial port connected here lets the
          // updater control the order and avoids stranding a module mid-flow.
          openGuide(guideTarget, manualReset);
        },
      });
    }).catch((error: unknown) => {
      console.warn("Could not check the firmware beta channel", error);
    });
  });
}

export function teardownFirmwareUpdatePrompt(): void {
  unsubscribe?.();
  unsubscribe = null;
  updateChannel?.close();
  updateChannel = null;
  offeredKey = null;
}
