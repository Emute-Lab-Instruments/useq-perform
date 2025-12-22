import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { RadialMenu } from "./RadialMenu";
import { createSignal } from "solid-js";

const meta: Meta<typeof RadialMenu> = {
  title: "UI/RadialMenu",
  component: RadialMenu,
  argTypes: {
    segmentCount: { control: { type: 'number', min: 1, max: 12 } },
    size: { control: { type: 'number' } },
    innerRadiusRatio: { control: { type: 'range', min: 0.1, max: 0.9, step: 0.05 } },
  },
};

export default meta;
type Story = StoryObj<typeof RadialMenu>;

export const Default: Story = {
  args: {
    segmentCount: 8,
    size: 300,
    labels: ["ONE", "TWO", "THREE", "FOUR", "FIVE", "SIX", "SEVEN", "EIGHT"],
    activeSegment: null,
    onHoverSegment: (idx) => console.log("Hover", idx),
  },
};

export const Interactive: Story = {
  render: (props) => {
    const [hovered, setHovered] = createSignal<number | null>(null);
    return (
      <RadialMenu
        {...props}
        activeSegment={hovered()}
        onHoverSegment={setHovered}
      />
    );
  },
  args: {
    segmentCount: 6,
    size: 300,
    labels: ["A", "B", "C", "D", "E", "F"],
  },
};
