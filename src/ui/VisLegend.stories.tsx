import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VisLegend, type VisLegendChannel } from "./VisLegend";

const meta: Meta<typeof VisLegend> = {
  title: "UI/VisLegend",
  component: VisLegend,
};

export default meta;
type Story = StoryObj<typeof VisLegend>;

const CHANNELS = ["a1", "a2", "a3", "a4", "d1", "d2", "d3"] as const;

const DARK_PALETTE = [
  "#00ff41",
  "#1adbdb",
  "#ffaa00",
  "#ff0080",
  "#ff5500",
  "#ffee33",
  "#0088ff",
  "#aa00ff",
];

const emptyChannels: VisLegendChannel[] = CHANNELS.map((ch, i) => ({
  channel: ch,
  color: DARK_PALETTE[i] ?? null,
  active: false,
  label: ch,
}));

const activeChannels: VisLegendChannel[] = CHANNELS.map((ch, i) => {
  const activeMap: Record<string, { text: string; color: string }> = {
    a1: { text: "(sin (* t 2))", color: "#00ff41" },
    a2: { text: "(cos (* t 3))", color: "#1adbdb" },
    d1: { text: "(gate 1)", color: "#ff0080" },
  };
  const active = activeMap[ch];
  return {
    channel: ch,
    color: active?.color ?? DARK_PALETTE[i] ?? null,
    active: !!active,
    label: active?.text ?? ch,
  };
});

export const Empty: Story = {
  render: () => (
    <div style={{ background: "#1e293b", padding: "12px" }}>
      <VisLegend channels={emptyChannels} />
    </div>
  ),
};

export const WithActiveExpressions: Story = {
  render: () => (
    <div style={{ background: "#1e293b", padding: "12px", color: "white" }}>
      <VisLegend channels={activeChannels} />
    </div>
  ),
};
