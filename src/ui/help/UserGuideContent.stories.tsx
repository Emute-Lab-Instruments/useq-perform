import type { Meta, StoryObj } from "@storybook/html";
import { UserGuideContent } from "./UserGuideContent";
import { render } from "solid-js/web";

const meta: Meta = {
  title: "UI/Help/Subcomponents/UserGuideContent",
  render: (args: any) => {
    const div = document.createElement("div");
    render(() => <UserGuideContent {...args} />, div);
    return div;
  },
};

export default meta;
type Story = StoryObj;

export const Loading: Story = {
  args: {
    loading: true,
    content: "",
    error: null,
  },
};

export const WithContent: Story = {
  args: {
    loading: false,
    content: "<h1>Test Guide</h1><p>This is some <strong>HTML</strong> content.</p>",
    error: null,
  },
};

export const WithCodeBlocks: Story = {
  args: {
    loading: false,
    content: `
<h2>Code Examples</h2>
<p>Try these patterns:</p>
<pre><code class="language-lisp">(d1 (sqr bar))</code></pre>
<p>A more complex sequence:</p>
<pre><code class="language-lisp">(d3 (seq [1 0 0 1 1 0 1 0] bar))</code></pre>
<p>Analog output:</p>
<pre><code class="language-lisp">(a1 (sin bar))</code></pre>`,
    error: null,
  },
};

export const WithError: Story = {
  args: {
    loading: false,
    content: "",
    error: new Error("Failed to load"),
  },
};
