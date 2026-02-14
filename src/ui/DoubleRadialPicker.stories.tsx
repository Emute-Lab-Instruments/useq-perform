import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { DoubleRadialPicker } from "./DoubleRadialPicker";

const meta: Meta<typeof DoubleRadialPicker> = {
  title: "UI/DoubleRadialPicker",
  component: DoubleRadialPicker,
};

export default meta;
type Story = StoryObj<typeof DoubleRadialPicker>;

const sampleCategories = [
  {
    label: "Movement",
    items: [
      { label: "Forward" },
      { label: "Backward" },
      { label: "Left" },
      { label: "Right" }
    ]
  },
  {
    label: "Action",
    items: [
      { label: "Jump" },
      { label: "Crouch" },
      { label: "Sprint" }
    ]
  },
  {
    label: "Combat",
    items: [
      { label: "Attack" },
      { label: "Defend" },
      { label: "Reload" }
    ]
  }
];

export const Default: Story = {
  args: {
    title: "Command Palette",
    categories: sampleCategories,
    onSelect: (entry) => console.log("Selected", entry),
    onCancel: () => console.log("Cancelled"),
  },
};
