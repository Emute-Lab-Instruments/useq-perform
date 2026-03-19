import type { Meta, StoryObj } from "storybook-solidjs-vite";
import { VisLegend } from "./VisLegend";
import {
  updateExpressions,
  setVisPalette,
  setLastChangeKind,
} from "../utils/visualisationStore";

const meta: Meta<typeof VisLegend> = {
  title: "UI/VisLegend",
  component: VisLegend,
};

export default meta;
type Story = StoryObj<typeof VisLegend>;

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

export const Empty: Story = {
  render: () => {
    setTimeout(() => {
      setVisPalette(DARK_PALETTE);
    }, 50);

    return (
      <div style={{ background: "#1e293b", padding: "12px" }}>
        <VisLegend />
      </div>
    );
  },
};

export const WithActiveExpressions: Story = {
  render: () => {
    setTimeout(() => {
      setVisPalette(DARK_PALETTE);
      updateExpressions({
        a1: {
          exprType: "a1",
          expressionText: "(sin (* t 2))",
          samples: [],
          color: "#00ff41",
        },
        a2: {
          exprType: "a2",
          expressionText: "(cos (* t 3))",
          samples: [],
          color: "#1adbdb",
        },
        d1: {
          exprType: "d1",
          expressionText: "(gate 1)",
          samples: [],
          color: "#ff0080",
        },
      });
      setLastChangeKind("register");
    }, 50);

    return (
      <div style={{ background: "#1e293b", padding: "12px", color: "white" }}>
        <VisLegend />
      </div>
    );
  },
};
