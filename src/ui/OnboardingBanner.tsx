/**
 * Inline onboarding banner shown near the Connect button area.
 *
 * Appears when no runtime is available (`none` mode) unless the user has
 * dismissed it for this session or permanently. "Dismiss" hides it for the
 * session only; "Don't show again" persists via the persistence service.
 * The WASM action enables the in-browser interpreter through the sanctioned
 * settings mutation surface (`runtimeService.updateSettings`).
 *
 * The banner never steals focus — it is a passive status element whose
 * buttons only act on explicit activation (see overlays.md §1.6).
 */

import { createSignal, onMount, onCleanup, Show } from "solid-js";
import {
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
  toggleRuntimeConnection,
  updateSettings,
} from "../runtime/runtimeService";
import { load, save, PERSISTENCE_KEYS } from "../lib/persistence";

type ConnectionMode = ReturnType<
  typeof getRuntimeServiceSnapshot
>["session"]["connectionMode"];

function readMode(
  state: ReturnType<typeof getRuntimeServiceSnapshot>,
): ConnectionMode {
  return state.session.connectionMode;
}

/**
 * Browser-local WASM runs in a Worker (runtime-modes.md §1.12); without
 * Worker or WebAssembly support the virtual uSEQ runtime is unavailable.
 */
function browserSupportsWasmRuntime(): boolean {
  return typeof Worker !== "undefined" && typeof WebAssembly !== "undefined";
}

export function OnboardingBanner() {
  const wasDismissed = load<boolean>(PERSISTENCE_KEYS.onboardingDismissed, false);
  const [dismissed, setDismissed] = createSignal(wasDismissed);
  const [mode, setMode] = createSignal<ConnectionMode>(
    readMode(getRuntimeServiceSnapshot()),
  );

  const wasmSupported = browserSupportsWasmRuntime();

  onMount(() => {
    const unsubscribe = subscribeRuntimeService((next) => {
      setMode(readMode(next));
    });
    onCleanup(unsubscribe);
  });

  /**
   * `none` mode means there is no runtime at all (WASM disabled and no
   * hardware) — the banner is urgent and must explain how to proceed. In any
   * connected mode (`browser`/`hardware`) the banner stays hidden.
   */
  const isUrgent = () => mode() === "none";
  const visible = () => !dismissed() && isUrgent();

  /** Session-only dismissal — intentionally not persisted. */
  function handleDismiss() {
    setDismissed(true);
  }

  /** Permanent dismissal — persists via the persistence service. */
  function handleDismissPermanently() {
    setDismissed(true);
    save(PERSISTENCE_KEYS.onboardingDismissed, true);
  }

  function handleConnect() {
    void toggleRuntimeConnection();
  }

  /**
   * Enable the in-browser interpreter through the sole settings mutation
   * surface (settings.md §1.2); runtimeService starts the WASM worker in
   * response and the session mode transitions out of `none`.
   */
  function handleEnableWasm() {
    updateSettings({ wasm: { enabled: true } });
  }

  return (
    <Show when={visible()}>
      <div
        class="onboarding-banner"
        classList={{ "onboarding-banner--urgent": isUrgent() }}
        role="status"
      >
        <span class="onboarding-banner__text">
          <strong>No runtime active.</strong>{" "}
          Connect your uSEQ module via USB, or use the built-in virtual
          interpreter (WASM) to run code without hardware.
        </span>
        <div class="onboarding-banner__actions">
          <button
            type="button"
            class="onboarding-banner__connect"
            title="Connect via USB"
            aria-label="Connect your uSEQ module via USB"
            onClick={handleConnect}
          >
            Connect uSEQ (USB)
          </button>
          <Show
            when={wasmSupported}
            fallback={
              <span
                class="onboarding-banner__wasm-note"
                title="This browser does not support WebAssembly or Web Workers, so the virtual uSEQ runtime is unavailable."
              >
                WASM unavailable in this browser
              </span>
            }
          >
            <button
              type="button"
              class="onboarding-banner__wasm"
              title="Enable the built-in virtual interpreter"
              aria-label="Use virtual uSEQ (WASM)"
              onClick={handleEnableWasm}
            >
              Use virtual uSEQ (WASM)
            </button>
          </Show>
        </div>
        <div class="onboarding-banner__dismiss-row">
          <button
            type="button"
            class="onboarding-banner__dismiss"
            title="Dismiss for this session"
            aria-label="Dismiss onboarding banner for this session"
            onClick={handleDismiss}
          >
            Dismiss
          </button>
          <button
            type="button"
            class="onboarding-banner__dismiss onboarding-banner__dismiss--permanent"
            title="Don't show the onboarding banner again"
            aria-label="Don't show the onboarding banner again"
            onClick={handleDismissPermanently}
          >
            Don't show again
          </button>
        </div>
      </div>
    </Show>
  );
}
