import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { DevModePanel } from "./DevModePanel";

const mockSerialComms = (() => {
  let connected = false;
  return {
    isConnectedToModule: () => connected,
    setConnectedToModule: (v: boolean) => {
      connected = v;
    },
  };
})();

const mockTimeGenerator = (() => {
  let running = false;
  let time = 0;
  return {
    startMockTimeGenerator: () => {
      running = true;
      return true;
    },
    stopMockTimeGenerator: () => {
      running = false;
    },
    isMockTimeGeneratorRunning: () => running,
    getCurrentMockTime: () => {
      if (running) time += 0.016;
      return time;
    },
    resetMockTimeGenerator: () => {
      time = 0;
      running = false;
    },
  };
})();

const mockControlInputs = (() => {
  const values: Record<string, number> = {
    ain1: 0.5,
    ain2: 0.5,
    din1: 0,
    din2: 0,
    swm: 0,
    swt: 0.5,
  };
  return {
    setControlValue: (name: string, value: number) => {
      values[name] = value;
    },
    getControlValue: (name: string) => values[name] ?? 0,
    getControlDefinitions: () => [
      { name: "ain1", label: "CV Input 1", min: 0, max: 1, step: 0.01, default: 0.5 },
      { name: "ain2", label: "CV Input 2", min: 0, max: 1, step: 0.01, default: 0.5 },
      { name: "din1", label: "Pulse In 1", min: 0, max: 1, step: 1, default: 0 },
      { name: "din2", label: "Pulse In 2", min: 0, max: 1, step: 1, default: 0 },
      { name: "swm", label: "Momentary Switch", min: 0, max: 1, step: 1, default: 0 },
      { name: "swt", label: "Toggle Switch", min: 0, max: 1, step: 0.5, default: 0.5 },
    ],
    resetAllControls: () => {
      values.ain1 = 0.5;
      values.ain2 = 0.5;
      values.din1 = 0;
      values.din2 = 0;
      values.swm = 0;
      values.swt = 0.5;
    },
    initializeMockControls: async () => {},
  };
})();

const meta: Meta<typeof DevModePanel> = {
  title: "UI/DevModePanel",
  component: DevModePanel,
};

export default meta;
type Story = StoryObj<typeof DevModePanel>;

export const Default: Story = {
  args: {
    serialComms: mockSerialComms,
    mockTimeGenerator: mockTimeGenerator,
    mockControlInputs: mockControlInputs,
  },
};
