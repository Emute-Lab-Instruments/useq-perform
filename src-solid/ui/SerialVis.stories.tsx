import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { SerialVis } from "./SerialVis";
import { applyVisualisationEvent } from "../utils/visualisationStore";

const meta: Meta<typeof SerialVis> = {
  title: "UI/SerialVis",
  component: SerialVis,
};

export default meta;
type Story = StoryObj<typeof SerialVis>;

function generateSineWaveSamples(
  frequency: number,
  duration: number,
  sampleCount: number,
  offset = 0
) {
  const samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const time = (i / sampleCount) * duration;
    samples.push({
      time,
      value: 0.5 + 0.4 * Math.sin(2 * Math.PI * frequency * time + offset),
    });
  }
  return samples;
}

export const Empty: Story = {
  render: () => (
    <div style={{ width: "600px", height: "300px", background: "#111" }}>
      <SerialVis />
    </div>
  ),
};

export const WithAnalogSignals: Story = {
  render: () => {
    setTimeout(() => {
      applyVisualisationEvent({
        kind: "data",
        currentTimeSeconds: 5,
        displayTimeSeconds: 5,
        settings: {
          windowDuration: 10,
          sampleCount: 200,
          lineWidth: 1.5,
          futureDashed: true,
          futureMaskOpacity: 0.35,
          futureMaskWidth: 12,
          circularOffset: 0,
          futureLeadSeconds: 1,
          digitalLaneGap: 4,
        },
        expressions: new Map([
          [
            "a1",
            {
              exprType: "a1",
              expressionText: "(sin (* t 2))",
              samples: generateSineWaveSamples(0.5, 12, 200),
              color: "#00ff41",
            },
          ],
          [
            "a2",
            {
              exprType: "a2",
              expressionText: "(cos (* t 3))",
              samples: generateSineWaveSamples(0.8, 12, 200, Math.PI / 3),
              color: "#1adbdb",
            },
          ],
        ]),
        bar: 0.5,
      });
    }, 100);

    return (
      <div style={{ width: "600px", height: "300px", background: "#111" }}>
        <SerialVis />
      </div>
    );
  },
};

export const WithDigitalSignals: Story = {
  render: () => {
    const squareWave = (freq: number, duration: number, count: number) => {
      const samples = [];
      for (let i = 0; i < count; i++) {
        const time = (i / count) * duration;
        samples.push({
          time,
          value: Math.sin(2 * Math.PI * freq * time) > 0 ? 1 : 0,
        });
      }
      return samples;
    };

    setTimeout(() => {
      applyVisualisationEvent({
        kind: "data",
        currentTimeSeconds: 5,
        displayTimeSeconds: 5,
        settings: {
          windowDuration: 10,
          sampleCount: 200,
          lineWidth: 1.5,
          futureDashed: true,
          futureMaskOpacity: 0.35,
          futureMaskWidth: 12,
          circularOffset: 0,
          futureLeadSeconds: 1,
          digitalLaneGap: 4,
        },
        expressions: new Map([
          [
            "d1",
            {
              exprType: "d1",
              expressionText: "(gate 1)",
              samples: squareWave(0.5, 12, 200),
              color: "#ff0080",
            },
          ],
          [
            "d2",
            {
              exprType: "d2",
              expressionText: "(gate 2)",
              samples: squareWave(1, 12, 200),
              color: "#ff5500",
            },
          ],
          [
            "d3",
            {
              exprType: "d3",
              expressionText: "(gate 3)",
              samples: squareWave(2, 12, 200),
              color: "#ffee33",
            },
          ],
        ]),
        bar: 0.3,
      });
    }, 100);

    return (
      <div style={{ width: "600px", height: "300px", background: "#111" }}>
        <SerialVis />
      </div>
    );
  },
};
