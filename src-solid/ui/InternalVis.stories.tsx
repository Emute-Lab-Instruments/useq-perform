import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { InternalVis } from "./InternalVis";
import { snapshotSerialBuffers, setVisPalette } from "../utils/visualisationStore";

const meta: Meta<typeof InternalVis> = {
  title: "UI/InternalVis",
  component: InternalVis,
};

export default meta;
type Story = StoryObj<typeof InternalVis>;

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

function makeFakeCircularBuffer(data: number[]) {
  return {
    length: data.length,
    capacity: data.length,
    oldest(i: number) {
      return data[i];
    },
  };
}

function generateSineBuffers() {
  const sampleCount = 400;
  const buffers = [];

  // Buffer 0: time channel
  const timeData = Array.from({ length: sampleCount }, (_, i) => i / 100);
  buffers.push(makeFakeCircularBuffer(timeData));

  // Buffers 1-8: sine waves with different frequencies
  for (let ch = 0; ch < 8; ch++) {
    const freq = (ch + 1) * 0.5;
    const phase = (ch * Math.PI) / 4;
    const data = Array.from({ length: sampleCount }, (_, i) => {
      const t = i / 100;
      return Math.sin(2 * Math.PI * freq * t + phase);
    });
    buffers.push(makeFakeCircularBuffer(data));
  }

  return buffers;
}

export const Default: Story = {
  render: () => {
    setTimeout(() => {
      setVisPalette(DARK_PALETTE);
      snapshotSerialBuffers(generateSineBuffers());
    }, 100);

    return (
      <div style={{ width: "600px", height: "300px", background: "#111" }}>
        <InternalVis />
      </div>
    );
  },
};

export const Empty: Story = {
  render: () => (
    <div style={{ width: "600px", height: "300px", background: "#111" }}>
      <InternalVis />
    </div>
  ),
};
