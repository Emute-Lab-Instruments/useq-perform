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

export interface FirmwareUpdateOffer {
  title: string;
  message: string;
  confirmLabel: string;
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
    title: "uSEQ firmware beta available",
    message:
      `This module is running ${installed}. ` +
      `Firmware v${manifest.version} is available on the public beta channel. ` +
      `${targetText} Your program stays saved in the editor.`,
    confirmLabel: "Prepare update",
  };
}

let unsubscribe: (() => void) | null = null;
let offeredKey: string | null = null;

export function initFirmwareUpdatePrompt(
  showConfirm: ConfirmPromptFn,
  dependencies: {
    loadManifest?: typeof fetchFirmwareManifest;
    openGuide?: (target: string | null) => void;
    enterBootloader?: () => Promise<boolean>;
  } = {},
): void {
  if (unsubscribe) return;
  const loadManifest = dependencies.loadManifest ?? fetchFirmwareManifest;
  const openGuide = dependencies.openGuide ?? ((target: string | null) => {
    const suffix = target ? `?target=${encodeURIComponent(target)}` : "";
    window.open(`${FIRMWARE_BETA_LANDING_PATH}${suffix}`, "_blank", "noopener");
  });
  const enterBootloader = dependencies.enterBootloader ?? (() => enterBootloaderMode());

  unsubscribe = protocolReady.subscribe(() => {
    const identity = getConnectedFirmwareIdentity();
    if (!identity.firmwareVersion) return;

    void loadManifest().then((manifest) => {
      if (!manifest) return;
      const offer = buildFirmwareUpdateOffer(identity, manifest);
      if (!offer) return;
      const key = [identity.firmwareVersion, identity.hardwareTarget, manifest.version].join(":");
      if (key === offeredKey) return;
      offeredKey = key;

      showConfirm({
        id: "firmware-beta-update",
        ...offer,
        cancelLabel: "Not now",
        onConfirm: () => {
          // Open synchronously from the click so popup blockers permit it,
          // then use the already-authorised serial port's 1200-baud reset.
          openGuide(identity.hardwareTarget);
          void enterBootloader().then((entered) => {
            if (entered) {
              post("uSEQ is ready for the verified UF2 file shown in the update guide.");
            }
          });
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
  offeredKey = null;
}
