import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { Section } from "./FormControls";
import { connectionChanged } from "../../contracts/runtimeChannels.ts";
import { isConnectedToModule, isJsonProtocolActive } from "../../transport/index.ts";
import { beginCalibration } from "../adapters/calibrationRuntime.ts";

export interface HardwareConnectionState {
  connected: boolean;
  jsonProtocol: boolean;
}

export interface HardwareSettingsProps {
  /** Probe the current transport connection. Defaults to the live transport state. */
  connectionProbe?: () => HardwareConnectionState;
  /**
   * Open the calibration flow. Defaults to the production `beginCalibration`
   * (calibration.md §2.1); returns false when no JSON-protocol module is ready.
   */
  onBeginCalibration?: () => boolean;
}

function probeLiveConnection(): HardwareConnectionState {
  return { connected: isConnectedToModule(), jsonProtocol: isJsonProtocolActive() };
}

/**
 * Settings panel Hardware section (calibration.md §2.1).
 *
 * Pure prop-driven like the other settings sections: production renders it
 * bare (defaults to the real transport probes and `beginCalibration`), while
 * tests and stories inject a probe and callback.
 */
export function HardwareSettings(props: HardwareSettingsProps = {}) {
  const probe = () => (props.connectionProbe ?? probeLiveConnection)();
  const [connection, setConnection] = createSignal<HardwareConnectionState>(probe());

  onMount(() => {
    setConnection(probe());
    const unsubscribe = connectionChanged.subscribe(({ connected, protocolMode }) => {
      setConnection({ connected, jsonProtocol: protocolMode === "json" });
    });
    onCleanup(unsubscribe);
  });

  const calibrationReady = () => connection().connected && connection().jsonProtocol;

  return (
    <Section title="Hardware">
      <Show
        when={calibrationReady()}
        fallback={
          <p class="panel-info-text">
            Output calibration needs a connected uSEQ module speaking the JSON
            protocol, so the button is disabled until a module is plugged in
            over USB.
          </p>
        }
      >
        <p class="panel-info-text">
          Calibrate the module's CV outputs against an external tuner or
          oscilloscope. Other outputs are frozen while calibration runs.
        </p>
      </Show>
      <div class="panel-button-group">
        <button
          type="button"
          class="panel-button"
          disabled={!calibrationReady()}
          onClick={() => (props.onBeginCalibration ?? beginCalibration)()}
        >
          Calibrate CV Outputs…
        </button>
      </div>
    </Section>
  );
}
