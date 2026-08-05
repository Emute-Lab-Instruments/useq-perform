/**
 * Hardware-connect "send current program?" prompt (runtime-modes.md §1.7).
 *
 * When hardware connects while the app is running WASM-only, the transport
 * mode upgrades `wasm` → `both`. At that moment the spec requires prompting:
 *   "Hardware connected. Send current program to device?"
 * letting the user decide whether to push the current editor program to the
 * freshly-connected hardware. On confirm, the current editor content is sent
 * over the serial transport.
 *
 * @see docs/specs/runtime-modes.md §1.7
 */

import {
  connectionChanged as connectionChangedChannel,
  type ConnectionChangedDetail,
} from "../contracts/runtimeChannels";
import type { TransportMode } from "../contracts/runtimeTypes";
import { sendTouSEQ } from "../transport/json-protocol.ts";
import { getEditorContent } from "../lib/editorStore.ts";
import { post } from "../utils/consoleStore.ts";
import { dbg } from "../lib/debug.ts";

/**
 * UI dependency injected by the app layer. `src/effects/` may not import
 * `src/ui/` (import boundary), so the confirm-modal surface is passed in.
 */
export interface ConfirmPromptFn {
  (opts: {
    id: string;
    title: string;
    message: string;
    confirmLabel?: string;
    cancelLabel?: string;
    secondaryLabel?: string;
    onConfirm: () => void;
    onCancel?: () => void;
    onSecondary?: () => void;
  }): void;
}

const PROMPT_ID = "hardware-connect-send-program";

let unsubscribe: (() => void) | null = null;
let previousMode: TransportMode | null = null;
let showConfirm: ConfirmPromptFn | null = null;

/**
 * True when the transition represents a fresh hardware connection while WASM
 * was the active runtime — i.e. `wasm` → `both`. A boot that comes up directly
 * in `both`/`hardware`, or a disconnect (`both` → `wasm`), must not prompt.
 */
function isWasmToBoth(prev: TransportMode | null, next: TransportMode): boolean {
  return prev === "wasm" && next === "both";
}

function handleConnectionChanged(detail: ConnectionChangedDetail): void {
  const next = detail.transportMode;
  const prev = previousMode;
  previousMode = next;

  if (!isWasmToBoth(prev, next)) return;
  if (!showConfirm) return;

  const program = getEditorContent();
  if (program === null || !program.trim()) {
    // Nothing to offer — hardware is connected but the editor is empty.
    return;
  }

  showConfirm({
    id: PROMPT_ID,
    title: "Hardware connected",
    message: "Hardware connected. Send current program to device?",
    confirmLabel: "Send program",
    cancelLabel: "Not now",
    onConfirm: () => {
      void sendTouSEQ(program).catch((error) => {
        dbg(`hardwareConnectPrompt: send failed: ${error}`);
      });
      post("Sent current program to hardware.");
    },
  });
}

/**
 * Subscribe to connection changes and prompt on a `wasm` → `both` transition.
 * Idempotent; safe to call once during bootstrap. The confirm-modal surface is
 * injected by the app layer to respect the effects → ui import boundary.
 */
export function initHardwareConnectPrompt(confirmPrompt: ConfirmPromptFn): void {
  showConfirm = confirmPrompt;
  if (unsubscribe) return;
  unsubscribe = connectionChangedChannel.subscribe(handleConnectionChanged);
}

export function teardownHardwareConnectPrompt(): void {
  unsubscribe?.();
  unsubscribe = null;
  previousMode = null;
  showConfirm = null;
}

// Exposed for tests.
export const __test__ = {
  handleConnectionChanged,
  isWasmToBoth,
  resetPreviousMode: () => {
    previousMode = null;
  },
  setPreviousMode: (mode: TransportMode | null) => {
    previousMode = mode;
  },
  setConfirmPrompt: (fn: ConfirmPromptFn | null) => {
    showConfirm = fn;
  },
};
