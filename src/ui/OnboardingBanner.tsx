/**
 * Inline onboarding banner shown near the Connect button area.
 *
 * Appears on first visit and whenever no hardware/WASM connection is
 * detected, unless the user has previously dismissed it. Dismissal is
 * persisted via the persistence service.
 */

import { createSignal, onMount, onCleanup, Show } from "solid-js";
import {
  getRuntimeServiceSnapshot,
  subscribeRuntimeService,
} from "../runtime/runtimeService";
import { load, save, PERSISTENCE_KEYS } from "../lib/persistence";

/** Check whether any connection (hardware or browser-local) is active. */
function isConnected(state: ReturnType<typeof getRuntimeServiceSnapshot>): boolean {
  return state.session.connectionMode !== "none";
}

export function OnboardingBanner() {
  const wasDismissed = load<boolean>(PERSISTENCE_KEYS.onboardingDismissed, false);
  const [dismissed, setDismissed] = createSignal(wasDismissed);
  const [connected, setConnected] = createSignal(
    isConnected(getRuntimeServiceSnapshot()),
  );

  onMount(() => {
    const unsubscribe = subscribeRuntimeService((next) => {
      setConnected(isConnected(next));
    });
    onCleanup(unsubscribe);
  });

  const visible = () => !dismissed() && !connected();

  function handleDismiss() {
    setDismissed(true);
    save(PERSISTENCE_KEYS.onboardingDismissed, true);
  }

  return (
    <Show when={visible()}>
      <div class="onboarding-banner" role="status">
        <span class="onboarding-banner__text">
          <strong>Welcome to uSEQ!</strong>{" "}
          Connect your module via USB, or use the built-in virtual interpreter
          to explore without hardware.
        </span>
        <button
          class="onboarding-banner__dismiss"
          title="Dismiss"
          aria-label="Dismiss onboarding banner"
          onClick={handleDismiss}
        >
          Dismiss
        </button>
      </div>
    </Show>
  );
}
