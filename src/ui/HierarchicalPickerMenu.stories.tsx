import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { HierarchicalPickerMenu, type HierarchicalItem } from "./HierarchicalPickerMenu";

const meta: Meta<typeof HierarchicalPickerMenu> = {
  title: "UI/HierarchicalPickerMenu",
  component: HierarchicalPickerMenu,
};

export default meta;
type Story = StoryObj<typeof HierarchicalPickerMenu>;

const sampleCategories = [
  {
    label: "Literals",
    id: "literals",
    items: [{ label: "Number...", value: "__NUMBER__", special: "number" }],
  },
  {
    label: "Maths",
    id: "maths",
    items: [
      { label: "+", value: "+", insertText: "(+ )" },
      { label: "-", value: "-", insertText: "(- )" },
      { label: "*", value: "*", insertText: "(* )" },
      { label: "/", value: "/", insertText: "(/ )" },
      { label: "abs", value: "abs", insertText: "(abs )" },
      { label: "mod", value: "mod", insertText: "(mod )" },
    ],
  },
  {
    label: "Control",
    id: "control",
    items: [
      { label: "if", value: "if", insertText: "(if )" },
      { label: "do", value: "do", insertText: "(do )" },
      { label: "let", value: "let", insertText: "(let )" },
    ],
  },
  {
    label: "Utils",
    id: "utils",
    items: [
      { label: "print", value: "print", insertText: "(print )" },
      { label: "time", value: "time", insertText: "(time )" },
    ],
  },
];

export const Default: Story = {
  args: {
    title: "Create",
    categories: sampleCategories,
    onSelect: (item: HierarchicalItem) => console.log("Selected:", item),
    onClose: () => console.log("Closed"),
  },
};
