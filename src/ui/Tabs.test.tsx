import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { Tabs } from "./Tabs";

describe("Tabs", () => {
  const tabs = [
    { id: "tab1", name: "Tab 1", content: () => <div data-testid="content1">Content 1</div> },
    { id: "tab2", name: "Tab 2", content: () => <div data-testid="content2">Content 2</div> },
  ];

  it("renders the first tab by default", () => {
    render(() => <Tabs tabs={tabs} />);
    const button1 = screen.getByText("Tab 1");
    const content1 = screen.getByTestId("content1");

    expect(button1).toHaveClass("active");
    expect(content1.parentElement).toHaveClass("active");
    // Inactive tab is in the DOM but hidden via CSS display:none
    const content2 = screen.getByTestId("content2");
    expect(content2.parentElement).not.toHaveClass("active");
    expect(content2.parentElement!.style.display).toBe("none");
  });

  it("switches tabs when clicked", async () => {
    render(() => <Tabs tabs={tabs} />);
    const button2 = screen.getByText("Tab 2");

    fireEvent.click(button2);

    expect(button2).toHaveClass("active");
    const content2 = screen.getByTestId("content2");
    expect(content2.parentElement).toHaveClass("active");
    // Previous tab is still in the DOM but hidden
    const content1 = screen.getByTestId("content1");
    expect(content1.parentElement).not.toHaveClass("active");
    expect(content1.parentElement!.style.display).toBe("none");
  });
});
