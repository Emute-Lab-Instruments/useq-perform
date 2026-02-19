import {
  For,
  Show,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";

/** Result shape returned by the legacy configManager.saveConfiguration() call. */
type SaveConfigurationResult = {
  success: boolean;
  method: "websocket" | "filesystem-api" | "download" | string;
  path?: string;
  name?: string;
};

// Types for the external APIs (lazy-loaded from legacy code)
type MockTimeGeneratorAPI = {
  startMockTimeGenerator: () => boolean;
  stopMockTimeGenerator: () => void;
  isMockTimeGeneratorRunning: () => boolean;
  getCurrentMockTime: () => number;
  resetMockTimeGenerator: () => void;
};

type ControlDefinition = {
  name: string;
  label: string;
  description?: string;
  min: number;
  max: number;
  step: number;
  default: number;
};

type MockControlInputsAPI = {
  setControlValue: (name: string, value: number) => void;
  getControlValue: (name: string) => number;
  getControlDefinitions: () => ControlDefinition[];
  resetAllControls: () => void;
  initializeMockControls: () => Promise<void>;
};

type SerialCommsAPI = {
  setConnectedToModule: (connected: boolean) => void;
  isConnectedToModule: () => boolean;
};

export type DevModePanelProps = {
  serialComms?: SerialCommsAPI;
  mockTimeGenerator?: MockTimeGeneratorAPI;
  mockControlInputs?: MockControlInputsAPI;
};

// --- Connection Tab ---

function ConnectionTab(props: {
  serialComms?: SerialCommsAPI;
  mockTimeGenerator?: MockTimeGeneratorAPI;
  mockControlInputs?: MockControlInputsAPI;
}) {
  const [isConnected, setIsConnected] = createSignal(false);

  const refreshStatus = () => {
    setIsConnected(props.serialComms?.isConnectedToModule() ?? false);
  };

  onMount(refreshStatus);

  const handleConnect = async () => {
    props.serialComms?.setConnectedToModule(true);
    refreshStatus();

    try {
      await props.mockControlInputs?.initializeMockControls();
    } catch (e) {
      console.error("Failed to initialize mock controls:", e);
    }

    if (
      props.mockTimeGenerator &&
      !props.mockTimeGenerator.isMockTimeGeneratorRunning()
    ) {
      props.mockTimeGenerator.startMockTimeGenerator();
    }
  };

  const handleDisconnect = () => {
    props.serialComms?.setConnectedToModule(false);
    refreshStatus();

    if (props.mockTimeGenerator?.isMockTimeGeneratorRunning()) {
      props.mockTimeGenerator.stopMockTimeGenerator();
    }
  };

  return (
    <div class="devmode-tab-content">
      <div class="devmode-section">
        <h3>Connection Status</h3>
        <div
          class={`devmode-status-display ${isConnected() ? "devmode-status-connected" : "devmode-status-disconnected"}`}
        >
          <strong>
            {isConnected() ? "Connected (Mock)" : "Disconnected"}
          </strong>
        </div>
      </div>

      <div class="devmode-section">
        <h3>Mock Connection</h3>
        <div class="devmode-button-group">
          <button
            class="devmode-button devmode-button-success"
            disabled={isConnected()}
            onClick={handleConnect}
          >
            Connect
          </button>
          <button
            class="devmode-button devmode-button-danger"
            disabled={!isConnected()}
            onClick={handleDisconnect}
          >
            Disconnect
          </button>
        </div>
      </div>

      <div class="devmode-section devmode-info">
        <p>
          <strong>Dev Mode Active:</strong> Mock the connection status to test
          expression evaluation without a physical uSEQ device. When
          "connected", expression gutter bars will activate when you evaluate
          code with Ctrl+Enter.
        </p>
      </div>
    </div>
  );
}

// --- Debug Tab ---

function DebugTab(props: {
  mockTimeGenerator?: MockTimeGeneratorAPI;
  mockControlInputs?: MockControlInputsAPI;
}) {
  return (
    <div class="devmode-tab-content">
      <TimeGeneratorSection api={props.mockTimeGenerator} />
      <Show when={props.mockControlInputs}>
        {(api) => <ControlInputsSection api={api()} />}
      </Show>
      <ConfigManagementSection />
    </div>
  );
}

type ConfigServerStatus = "checking" | "connected" | "unavailable" | "error";

function ConfigManagementSection() {
  const [status, setStatus] = createSignal<ConfigServerStatus>("checking");
  const [saving, setSaving] = createSignal(false);

  const checkConfigServerStatus = async () => {
    try {
      const configManager = await import("../legacy/config/configManager.ts");
      const ws = await configManager.connectToConfigServer();
      setStatus(ws ? "connected" : "unavailable");
    } catch {
      setStatus("error");
    }
  };

  const handleSaveConfig = async () => {
    setSaving(true);
    try {
      const configManager = await import("../legacy/config/configManager.ts");
      const result = await configManager.saveConfiguration({
        includeDevMode: true,
        includeCode: false,
      }) as SaveConfigurationResult;

      if (result.success && result.method === "websocket") {
        setStatus("connected");
        alert(
          `Configuration saved to:\n${result.path}\n\nAll current UI settings and mock control values have been saved.\nCommit this file to preserve your configuration!`,
        );
      } else if (result.success && result.method === "filesystem-api") {
        alert(`Configuration saved to:\n${result.name}`);
      } else if (result.success && result.method === "download") {
        alert(
          "Configuration downloaded.\n\nCopy the file to:\nsrc/config/default-config.json\n\nto make changes persist across builds.",
        );
      } else {
        alert(`Configuration exported via ${result.method}`);
      }
    } catch (error: unknown) {
      alert(`Failed to save configuration:\n${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  onMount(() => {
    void checkConfigServerStatus();
  });

  const statusClass = () =>
    status() === "connected"
      ? "devmode-status-connected"
      : "devmode-status-disconnected";

  const statusText = () => {
    if (status() === "checking") return "Config server status: checking...";
    if (status() === "connected") return "Config server: Connected";
    if (status() === "unavailable") return "Config server: Not available";
    return "Config server: Error";
  };

  return (
    <div class="devmode-section">
      <h3>Configuration Management</h3>
      <div class={`devmode-status-display ${statusClass()}`}>
        <strong>{statusText()}</strong>
      </div>
      <button
        class="devmode-button devmode-button-success"
        disabled={saving()}
        onClick={() => void handleSaveConfig()}
      >
        Save Config to Source File
      </button>
      <div class="devmode-info">
        <p>
          <strong>Config Persistence:</strong> Saves all UI settings and mock
          control values to <code>src/config/default-config.json</code>. When
          the config server is running (via npm run dev), changes write
          directly to the source file.
        </p>
      </div>
    </div>
  );
}

function TimeGeneratorSection(props: { api?: MockTimeGeneratorAPI }) {
  const [isRunning, setIsRunning] = createSignal(false);
  const [currentTime, setCurrentTime] = createSignal(0);

  let intervalId: ReturnType<typeof setInterval> | null = null;

  const refresh = () => {
    if (!props.api) return;
    setIsRunning(props.api.isMockTimeGeneratorRunning());
    setCurrentTime(props.api.getCurrentMockTime());
  };

  onMount(refresh);

  const startUpdates = () => {
    if (intervalId !== null) clearInterval(intervalId);
    intervalId = setInterval(() => {
      if (props.api?.isMockTimeGeneratorRunning()) {
        refresh();
      } else {
        if (intervalId !== null) clearInterval(intervalId);
        intervalId = null;
        refresh();
      }
    }, 100);
  };

  onCleanup(() => {
    if (intervalId !== null) clearInterval(intervalId);
  });

  const handleStart = () => {
    props.api?.startMockTimeGenerator();
    refresh();
    startUpdates();
  };

  const handleStop = () => {
    props.api?.stopMockTimeGenerator();
    refresh();
  };

  const handleReset = () => {
    props.api?.resetMockTimeGenerator();
    refresh();
  };

  return (
    <div class="devmode-section">
      <h3>Mock Time Generator</h3>
      <div
        class={`devmode-status-display ${isRunning() ? "devmode-status-connected" : "devmode-status-disconnected"}`}
      >
        <strong>
          {isRunning()
            ? `Running (t=${currentTime().toFixed(3)}s)`
            : "Stopped"}
        </strong>
      </div>
      <div class="devmode-button-group">
        <button
          class="devmode-button devmode-button-success"
          disabled={isRunning()}
          onClick={handleStart}
        >
          Start
        </button>
        <button
          class="devmode-button devmode-button-danger"
          disabled={!isRunning()}
          onClick={handleStop}
        >
          Stop
        </button>
        <button class="devmode-button" onClick={handleReset}>
          Reset
        </button>
      </div>
      <div class="devmode-info">
        <p>
          <strong>Mock Time Generator:</strong> Simulates the time updates that
          normally come from the uSEQ module. When running, the serialVis will
          advance at ~60fps using wall-clock time, starting from t=0.
        </p>
      </div>
    </div>
  );
}

function ControlInputsSection(props: { api: MockControlInputsAPI }) {
  const definitions = () => props.api.getControlDefinitions();

  const [controlValues, setControlValues] = createSignal<
    Record<string, number>
  >({});

  onMount(() => {
    const vals: Record<string, number> = {};
    for (const def of definitions()) {
      vals[def.name] = props.api.getControlValue(def.name);
    }
    setControlValues(vals);
  });

  const handleSliderChange = (name: string, value: number) => {
    props.api.setControlValue(name, value);
    setControlValues((prev) => ({ ...prev, [name]: value }));
  };

  const handleResetAll = () => {
    props.api.resetAllControls();
    const vals: Record<string, number> = {};
    for (const def of definitions()) {
      vals[def.name] = props.api.getControlValue(def.name);
    }
    setControlValues(vals);
  };

  return (
    <div class="devmode-section">
      <h3>Mock Control Inputs</h3>
      <div class="devmode-controls-container">
        <For each={definitions()}>
          {(def) => (
            <div class="devmode-control-row" title={def.description}>
              <label class="devmode-control-label" for={`devmode-control-${def.name}`}>
                {def.label}
              </label>
              <div class="devmode-control-slider-container">
                <input
                  type="range"
                  id={`devmode-control-${def.name}`}
                  class="devmode-control-slider"
                  min={def.min}
                  max={def.max}
                  step={def.step}
                  value={controlValues()[def.name] ?? def.default}
                  onInput={(e) =>
                    handleSliderChange(def.name, parseFloat(e.currentTarget.value))
                  }
                />
                <span class="devmode-control-value">
                  {(controlValues()[def.name] ?? def.default).toFixed(2)}
                </span>
              </div>
            </div>
          )}
        </For>
      </div>
      <button class="devmode-button" onClick={handleResetAll}>
        Reset All
      </button>
      <div class="devmode-info">
        <p>
          <strong>Mock Control Inputs:</strong> Simulates the hardware control
          inputs (CV inputs, pulse inputs, switches) that would normally come
          from the uSEQ module. Use the sliders to change values and test code
          that uses these controls.
        </p>
      </div>
    </div>
  );
}

// --- Main DevModePanel ---

export function DevModePanel(props: DevModePanelProps) {
  const [activeTab, setActiveTab] = createSignal<"connection" | "debug">(
    "connection",
  );

  return (
    <div class="devmode-panel">
      <div class="devmode-tabs">
        <button
          class={`devmode-tab ${activeTab() === "connection" ? "active" : ""}`}
          onClick={() => setActiveTab("connection")}
        >
          Connection
        </button>
        <button
          class={`devmode-tab ${activeTab() === "debug" ? "active" : ""}`}
          onClick={() => setActiveTab("debug")}
        >
          Debug
        </button>
      </div>
      <Show when={activeTab() === "connection"}>
        <ConnectionTab
          serialComms={props.serialComms}
          mockTimeGenerator={props.mockTimeGenerator}
          mockControlInputs={props.mockControlInputs}
        />
      </Show>
      <Show when={activeTab() === "debug"}>
        <DebugTab
          mockTimeGenerator={props.mockTimeGenerator}
          mockControlInputs={props.mockControlInputs}
        />
      </Show>
    </div>
  );
}
