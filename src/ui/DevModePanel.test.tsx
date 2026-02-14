import { render, fireEvent, cleanup, screen } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DevModePanel, type DevModePanelProps } from "./DevModePanel";

// Mock the dynamic import of configManager used by ConfigManagementSection
vi.mock("../legacy/config/configManager.ts", () => ({
  connectToConfigServer: vi.fn().mockResolvedValue(null),
  saveConfiguration: vi.fn().mockResolvedValue({
    success: true,
    method: "download",
  }),
}));

function createMockSerialComms() {
  let connected = false;
  return {
    setConnectedToModule: vi.fn((val: boolean) => {
      connected = val;
    }),
    isConnectedToModule: vi.fn(() => connected),
  };
}

function createMockTimeGenerator() {
  let running = false;
  return {
    startMockTimeGenerator: vi.fn(() => {
      running = true;
      return true;
    }),
    stopMockTimeGenerator: vi.fn(() => {
      running = false;
    }),
    isMockTimeGeneratorRunning: vi.fn(() => running),
    getCurrentMockTime: vi.fn(() => 0),
    resetMockTimeGenerator: vi.fn(() => {
      running = false;
    }),
  };
}

function createMockControlInputs() {
  return {
    setControlValue: vi.fn(),
    getControlValue: vi.fn(() => 0),
    getControlDefinitions: vi.fn(() => [
      {
        name: "cv1",
        label: "CV 1",
        description: "Control voltage 1",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        name: "cv2",
        label: "CV 2",
        description: "Control voltage 2",
        min: -1,
        max: 1,
        step: 0.1,
        default: 0,
      },
    ]),
    resetAllControls: vi.fn(),
    initializeMockControls: vi.fn().mockResolvedValue(undefined),
  };
}

describe("DevModePanel", () => {
  let mockSerial: ReturnType<typeof createMockSerialComms>;
  let mockTime: ReturnType<typeof createMockTimeGenerator>;
  let mockControls: ReturnType<typeof createMockControlInputs>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSerial = createMockSerialComms();
    mockTime = createMockTimeGenerator();
    mockControls = createMockControlInputs();
  });

  afterEach(() => {
    cleanup();
  });

  function renderPanel(overrides: Partial<DevModePanelProps> = {}) {
    return render(() => (
      <DevModePanel
        serialComms={mockSerial}
        mockTimeGenerator={mockTime}
        mockControlInputs={mockControls}
        {...overrides}
      />
    ));
  }

  describe("tab rendering and switching", () => {
    it("renders the panel container", () => {
      const { container } = renderPanel();
      expect(container.querySelector(".devmode-panel")).toBeTruthy();
    });

    it("renders Connection and Debug tab buttons", () => {
      renderPanel();
      expect(screen.getByText("Connection")).toBeTruthy();
      expect(screen.getByText("Debug")).toBeTruthy();
    });

    it("shows connection tab content by default", () => {
      renderPanel();
      expect(screen.getByText("Connection Status")).toBeTruthy();
      expect(screen.getByText("Mock Connection")).toBeTruthy();
    });

    it("switches to debug tab when clicked", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Debug"));

      expect(screen.getByText("Mock Time Generator")).toBeTruthy();
    });

    it("switches back to connection tab", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Debug"));
      await fireEvent.click(screen.getByText("Connection"));

      expect(screen.getByText("Connection Status")).toBeTruthy();
      expect(screen.getByText("Mock Connection")).toBeTruthy();
    });

    it("applies active class to the selected tab", () => {
      const { container } = renderPanel();
      const tabs = container.querySelectorAll(".devmode-tab");
      expect(tabs[0].classList.contains("active")).toBe(true);
      expect(tabs[1].classList.contains("active")).toBe(false);
    });

    it("moves active class when switching tabs", async () => {
      const { container } = renderPanel();
      await fireEvent.click(screen.getByText("Debug"));

      const tabs = container.querySelectorAll(".devmode-tab");
      expect(tabs[0].classList.contains("active")).toBe(false);
      expect(tabs[1].classList.contains("active")).toBe(true);
    });
  });

  describe("ConnectionTab", () => {
    it("shows Disconnected status initially", () => {
      renderPanel();
      expect(screen.getByText("Disconnected")).toBeTruthy();
    });

    it("renders Connect and Disconnect buttons", () => {
      renderPanel();
      expect(screen.getByText("Connect")).toBeTruthy();
      expect(screen.getByText("Disconnect")).toBeTruthy();
    });

    it("Connect button is enabled when disconnected", () => {
      const { container } = renderPanel();
      const connectBtn = container.querySelector(
        ".devmode-button-success"
      ) as HTMLButtonElement;
      expect(connectBtn.disabled).toBe(false);
    });

    it("Disconnect button is disabled when disconnected", () => {
      const { container } = renderPanel();
      const disconnectBtn = container.querySelector(
        ".devmode-button-danger"
      ) as HTMLButtonElement;
      expect(disconnectBtn.disabled).toBe(true);
    });

    it("calls setConnectedToModule(true) on Connect click", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));

      expect(mockSerial.setConnectedToModule).toHaveBeenCalledWith(true);
    });

    it("shows Connected (Mock) after clicking Connect", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));

      expect(screen.getByText("Connected (Mock)")).toBeTruthy();
    });

    it("starts mock time generator on connect when not running", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));

      expect(mockTime.startMockTimeGenerator).toHaveBeenCalled();
    });

    it("initializes mock controls on connect", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));

      expect(mockControls.initializeMockControls).toHaveBeenCalled();
    });

    it("calls setConnectedToModule(false) on Disconnect click", async () => {
      // First connect
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));

      // Then disconnect
      await fireEvent.click(screen.getByText("Disconnect"));

      expect(mockSerial.setConnectedToModule).toHaveBeenCalledWith(false);
    });

    it("stops mock time generator on disconnect", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));

      // Clear to check disconnect behavior
      mockTime.stopMockTimeGenerator.mockClear();
      await fireEvent.click(screen.getByText("Disconnect"));

      expect(mockTime.stopMockTimeGenerator).toHaveBeenCalled();
    });

    it("shows Disconnected after disconnect", async () => {
      renderPanel();
      await fireEvent.click(screen.getByText("Connect"));
      expect(screen.getByText("Connected (Mock)")).toBeTruthy();

      await fireEvent.click(screen.getByText("Disconnect"));
      expect(screen.getByText("Disconnected")).toBeTruthy();
    });

    it("applies status CSS classes correctly", async () => {
      const { container } = renderPanel();

      let statusEl = container.querySelector(".devmode-status-display");
      expect(statusEl?.classList.contains("devmode-status-disconnected")).toBe(
        true
      );

      await fireEvent.click(screen.getByText("Connect"));

      statusEl = container.querySelector(".devmode-status-display");
      expect(statusEl?.classList.contains("devmode-status-connected")).toBe(
        true
      );
    });
  });

  describe("DebugTab", () => {
    async function switchToDebug() {
      await fireEvent.click(screen.getByText("Debug"));
    }

    describe("TimeGeneratorSection", () => {
      it("renders time generator section", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Mock Time Generator")).toBeTruthy();
      });

      it("shows Stopped status initially", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Stopped")).toBeTruthy();
      });

      it("renders Start, Stop, and Reset buttons", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Start")).toBeTruthy();
        expect(screen.getByText("Stop")).toBeTruthy();
        expect(screen.getByText("Reset")).toBeTruthy();
      });

      it("Start button is enabled when stopped", async () => {
        const { container } = renderPanel();
        await switchToDebug();

        const startBtn = container.querySelector(
          ".devmode-button-success"
        ) as HTMLButtonElement;
        expect(startBtn.disabled).toBe(false);
      });

      it("calls startMockTimeGenerator when Start is clicked", async () => {
        renderPanel();
        await switchToDebug();
        await fireEvent.click(screen.getByText("Start"));

        expect(mockTime.startMockTimeGenerator).toHaveBeenCalled();
      });

      it("calls stopMockTimeGenerator when Stop is clicked", async () => {
        renderPanel();
        await switchToDebug();

        // Start first
        await fireEvent.click(screen.getByText("Start"));
        mockTime.stopMockTimeGenerator.mockClear();

        await fireEvent.click(screen.getByText("Stop"));
        expect(mockTime.stopMockTimeGenerator).toHaveBeenCalled();
      });

      it("calls resetMockTimeGenerator when Reset is clicked", async () => {
        renderPanel();
        await switchToDebug();

        await fireEvent.click(screen.getByText("Reset"));
        expect(mockTime.resetMockTimeGenerator).toHaveBeenCalled();
      });
    });

    describe("ControlInputsSection", () => {
      it("renders control inputs section", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Mock Control Inputs")).toBeTruthy();
      });

      it("renders sliders for each control definition", async () => {
        const { container } = renderPanel();
        await switchToDebug();

        expect(screen.getByText("CV 1")).toBeTruthy();
        expect(screen.getByText("CV 2")).toBeTruthy();

        const sliders = container.querySelectorAll(
          'input[type="range"]'
        );
        expect(sliders.length).toBe(2);
      });

      it("renders Reset All button", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Reset All")).toBeTruthy();
      });

      it("calls resetAllControls on Reset All click", async () => {
        renderPanel();
        await switchToDebug();
        await fireEvent.click(screen.getByText("Reset All"));

        expect(mockControls.resetAllControls).toHaveBeenCalled();
      });

      it("sets correct min/max/step on sliders", async () => {
        const { container } = renderPanel();
        await switchToDebug();

        const cv1Slider = container.querySelector(
          "#devmode-control-cv1"
        ) as HTMLInputElement;
        expect(cv1Slider.min).toBe("0");
        expect(cv1Slider.max).toBe("1");
        expect(cv1Slider.step).toBe("0.01");

        const cv2Slider = container.querySelector(
          "#devmode-control-cv2"
        ) as HTMLInputElement;
        expect(cv2Slider.min).toBe("-1");
        expect(cv2Slider.max).toBe("1");
        expect(cv2Slider.step).toBe("0.1");
      });
    });

    describe("ConfigManagementSection", () => {
      it("renders config management section", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Configuration Management")).toBeTruthy();
      });

      it("renders Save Config button", async () => {
        renderPanel();
        await switchToDebug();
        expect(screen.getByText("Save Config to Source File")).toBeTruthy();
      });
    });
  });

  describe("rendering without optional props", () => {
    it("renders without serialComms", () => {
      const { container } = render(() => (
        <DevModePanel
          mockTimeGenerator={mockTime}
          mockControlInputs={mockControls}
        />
      ));
      expect(container.querySelector(".devmode-panel")).toBeTruthy();
    });

    it("renders without mockTimeGenerator", () => {
      const { container } = render(() => (
        <DevModePanel
          serialComms={mockSerial}
          mockControlInputs={mockControls}
        />
      ));
      expect(container.querySelector(".devmode-panel")).toBeTruthy();
    });

    it("renders without any props", () => {
      const { container } = render(() => <DevModePanel />);
      expect(container.querySelector(".devmode-panel")).toBeTruthy();
    });

    it("shows Disconnected when serialComms is undefined", () => {
      render(() => <DevModePanel />);
      expect(screen.getByText("Disconnected")).toBeTruthy();
    });
  });
});
