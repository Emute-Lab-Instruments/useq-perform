import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { Tabs } from "./Tabs";

describe("Tabs", () => {
  const tabs = [
    { id: "tab1", name: "Tab 1", content: () => <div data-testid="content1">Content 1</div> },
    { id: "tab2", name: "Tab 2", content: () => <div data-testid="content2">Content 2</div> },
  ];

  it("renders only the active tab by default; inactive tabs are not yet mounted", () => {
    render(() => <Tabs tabs={tabs} />);
    const button1 = screen.getByText("Tab 1");
    const content1 = screen.getByTestId("content1");

    expect(button1).toHaveClass("active");
    expect(content1.parentElement).toHaveClass("active");
    // Tab 2 has not been activated yet — its content factory is not invoked.
    expect(screen.queryByTestId("content2")).toBeNull();
  });

  it("mounts a tab the first time it becomes active and keeps it mounted afterwards", async () => {
    render(() => <Tabs tabs={tabs} />);
    const button1 = screen.getByText("Tab 1");
    const button2 = screen.getByText("Tab 2");

    fireEvent.click(button2);

    expect(button2).toHaveClass("active");
    const content2 = screen.getByTestId("content2");
    expect(content2.parentElement).toHaveClass("active");
    // Tab 1 was already activated, so its content stays in the DOM, just hidden.
    const content1 = screen.getByTestId("content1");
    expect(content1.parentElement).not.toHaveClass("active");
    expect(content1.parentElement!.style.display).toBe("none");

    // Switching back doesn't re-mount Tab 1 — same DOM node.
    fireEvent.click(button1);
    expect(screen.getByTestId("content1")).toBe(content1);
    expect(content2.parentElement!.style.display).toBe("none");
  });
});
