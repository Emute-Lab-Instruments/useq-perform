import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { PickerMenu, NumberPickerMenu, type PickerMenuItem } from "./PickerMenu";

const meta: Meta<typeof PickerMenu> = {
  title: "UI/PickerMenu",
  component: PickerMenu,
};

export default meta;
type Story = StoryObj<typeof PickerMenu>;

const sampleItems = [
  { label: "Forward", value: "forward" },
  { label: "Backward", value: "backward" },
  { label: "Left", value: "left" },
  { label: "Right", value: "right" },
  { label: "Jump", value: "jump" },
  { label: "Crouch", value: "crouch" },
  { label: "Sprint", value: "sprint" },
  { label: "Reload", value: "reload" },
  { label: "Interact", value: "interact" },
];

export const Grid: Story = {
  args: {
    title: "Pick an Action",
    items: sampleItems,
    layout: "grid",
    onSelect: (item: PickerMenuItem, index: number) => console.log("Selected", item, "at", index),
    onClose: () => console.log("Closed"),
  },
};

export const Vertical: Story = {
  args: {
    title: "Pick an Action",
    items: sampleItems.slice(0, 5),
    layout: "vertical",
    onSelect: (item: PickerMenuItem, index: number) => console.log("Selected", item, "at", index),
    onClose: () => console.log("Closed"),
  },
};

export const WithInitialIndex: Story = {
  args: {
    title: "Pre-selected",
    items: sampleItems,
    layout: "grid",
    initialIndex: 3,
    onSelect: (item: PickerMenuItem, index: number) => console.log("Selected", item, "at", index),
    onClose: () => console.log("Closed"),
  },
};

// NumberPickerMenu story
const numberMeta: Meta<typeof NumberPickerMenu> = {
  title: "UI/NumberPickerMenu",
  component: NumberPickerMenu,
};

export const NumberPicker: StoryObj<typeof NumberPickerMenu> = {
  render: () => (
    <NumberPickerMenu
      title="Pick a Number"
      initialValue={5}
      min={0}
      max={100}
      step={1}
      onSelect={(v) => console.log("Number selected:", v)}
      onClose={() => console.log("Closed")}
    />
  ),
};
