import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { EngineIndicator } from "@src/audio/engineIndicator";
import type { EngineStateSnapshot } from "@src/contracts/synthesisChannels";

const noop = () => {};

const snapshot = (
  state: EngineStateSnapshot["state"],
  reasonKey: EngineStateSnapshot["reasonKey"] = null,
  reasonMessage: string | null = null,
): EngineStateSnapshot => ({
  state,
  reasonKey,
  reasonMessage,
  transitionCount: state === "off" ? 0 : 1,
  transitionedAt: 0,
});

const meta: Meta<typeof EngineIndicator> = {
  title: "Toolbar/Engine Indicator",
  tags: ["autodocs"],
  component: EngineIndicator,
  decorators: [
    (Story) => (
      <div id="panel-top-toolbar" style={{ background: "#1e293b", padding: "1rem" }}>
        <div id="engine-indicator-root"><Story /></div>
      </div>
    ),
  ],
  args: { onResume: noop },
};

export default meta;
type Story = StoryObj<typeof EngineIndicator>;

export const Off: Story = {
  args: { state: snapshot("off") },
};

export const Suspended: Story = {
  args: {
    state: snapshot(
      "suspended",
      "AWAITING_USER_ACTIVATION",
      "Audio is suspended. Click the indicator or press any key to enable sound.",
    ),
  },
};

export const Running: Story = {
  args: { state: snapshot("running") },
};

export const ErrorRecovery: Story = {
  args: {
    state: snapshot(
      "error",
      "PRODUCER_TIMEOUT",
      "The control producer stopped responding. Output has been faded to silence.",
    ),
  },
};
