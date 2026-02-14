import type { Meta, StoryObj } from "storybook-solidjs-vite";
import type { JSX } from "solid-js";
import { ConsolePanel } from "./ConsolePanel";
import { addConsoleMessage, clearConsole } from "../../utils/consoleStore";

const meta: Meta<typeof ConsolePanel> = {
  title: "UI/Console/ConsolePanel",
  component: ConsolePanel,
  tags: ["autodocs"],
  decorators: [
    (Story: () => JSX.Element) => {
      clearConsole();
      return (
        <div style={{ width: "600px", height: "400px", padding: "20px", background: "#0f1115" }}>
          <Story />
        </div>
      );
    },
  ],
};

export default meta;
type Story = StoryObj<typeof ConsolePanel>;

export const Empty: Story = {
  args: {
    maxHeight: "300px",
  },
};

export const WithLogMessages: Story = {
  args: {
    maxHeight: "300px",
  },
  render: () => {
    clearConsole();
    // Add some log messages
    addConsoleMessage("Application started successfully", "log");
    addConsoleMessage("Connected to serial port /dev/ttyUSB0", "log");
    addConsoleMessage("Configuration loaded: 42 settings applied", "log");
    addConsoleMessage("Editor initialized with 3 tabs", "log");

    return <ConsolePanel maxHeight="300px" />;
  },
};

export const WithMixedMessages: Story = {
  args: {
    maxHeight: "300px",
  },
  render: () => {
    clearConsole();
    // Add mixed message types
    addConsoleMessage("Application started", "log");
    addConsoleMessage("Connected to module", "log");
    addConsoleMessage("Warning: Buffer at 80% capacity", "warn");
    addConsoleMessage("Received data: [0x01, 0x02, 0x03]", "wasm");
    addConsoleMessage("Error: Failed to write to serial port", "error");
    addConsoleMessage("Retrying connection...", "log");
    addConsoleMessage("Connection established", "log");
    addConsoleMessage("Warning: High latency detected (245ms)", "warn");

    return <ConsolePanel maxHeight="300px" />;
  },
};

export const WithManyMessages: Story = {
  args: {
    maxHeight: "300px",
  },
  render: () => {
    clearConsole();
    // Add many messages to test scrolling
    for (let i = 0; i < 50; i++) {
      const types = ["log", "log", "log", "warn", "error", "wasm"] as const;
      const type = types[Math.floor(Math.random() * types.length)];
      const messages = [
        `Processing batch ${i + 1}`,
        `Sending command: CMD_${1000 + i}`,
        `Received response in ${Math.floor(Math.random() * 100)}ms`,
        `Buffer size: ${Math.floor(Math.random() * 1024)} bytes`,
      ];
      const msg = messages[Math.floor(Math.random() * messages.length)];
      addConsoleMessage(msg, type);
    }

    return <ConsolePanel maxHeight="300px" />;
  },
};

export const WithMarkdownContent: Story = {
  args: {
    maxHeight: "300px",
  },
  render: () => {
    clearConsole();
    addConsoleMessage("Regular log message", "log");
    addConsoleMessage("<strong>Bold message</strong> with <em>emphasis</em>", "log");
    addConsoleMessage('Link: <a href="#">Click here</a>', "log");
    addConsoleMessage("Code: <code>print('hello')</code>", "log");

    return <ConsolePanel maxHeight="300px" />;
  },
};
