import type { Meta, StoryObj } from "@storybook/html";
import { createSignal } from "solid-js";
import { render } from "solid-js/web";
import { CodeMirrorEditor } from "./CodeMirrorEditor";

const meta: Meta = {
  title: "UI/Help/CodeMirrorEditor",
  tags: ["autodocs"],
  render: (args: any) => {
    const container = document.createElement("div");
    container.style.padding = "12px";
    container.style.maxWidth = "680px";
    container.style.background = "var(--background, #0f1115)";

    const Story = () => {
      const [code, setCode] = createSignal(args.code ?? "");
      return (
        <CodeMirrorEditor
          code={code()}
          readOnly={args.readOnly}
          minHeight={args.minHeight}
          maxHeight={args.maxHeight}
          fontSize={args.fontSize}
          onCodeChange={(next) => {
            setCode(next);
            args.onCodeChange?.(next);
          }}
        />
      );
    };

    render(() => <Story />, container);
    return container;
  },
};

export default meta;
type Story = StoryObj;

export const Editable: Story = {
  args: {
    code: "(defn greet [name]\n  (str \"Hello, \" name \"!\"))",
    readOnly: false,
    minHeight: "80px",
    maxHeight: "220px",
    fontSize: "13px",
    onCodeChange: (next: string) => console.log("Code changed:", next),
  },
};

export const ReadOnly: Story = {
  args: {
    code: "(map inc [1 2 3 4])",
    readOnly: true,
    minHeight: "60px",
    maxHeight: "120px",
    fontSize: "12px",
  },
};
