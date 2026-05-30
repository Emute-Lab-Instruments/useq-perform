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
  toggleRuntimeConnection,
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

export function OnboardingBanner() {
  const wasDismissed = load<boolean>(PERSISTENCE_KEYS.onboardingDismissed, false);
  const [dismissed, setDismissed] = createSignal(wasDismissed);
  const [mode, setMode] = createSignal<ConnectionMode>(
    readMode(getRuntimeServiceSnapshot()),
  );

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

  function handleDismiss() {
    setDismissed(true);
    save(PERSISTENCE_KEYS.onboardingDismissed, true);
  }

  function handleConnect() {
    void toggleRuntimeConnection();
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
          Connect your uSEQ module via USB, or enable the built-in virtual
          interpreter (WASM) in Settings to run code without hardware.
        </span>
        <button
          class="onboarding-banner__connect"
          title="Connect via USB"
          aria-label="Connect your uSEQ module via USB"
          onClick={handleConnect}
        >
          Connect
        </button>
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
