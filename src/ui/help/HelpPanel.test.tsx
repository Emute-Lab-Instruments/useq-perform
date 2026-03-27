import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";

// Mock child tabs to avoid complex dependencies (fetch, markdown, etc.)
vi.mock("./guide/GuideTab", () => ({
  GuideTab: () => <div data-testid="guide-v2">Guide Content</div>,
}));
vi.mock("./ReferencePanel", () => ({
  ReferencePanel: () => <div data-testid="reference">Reference Content</div>,
}));
vi.mock("./CodeSnippetsTab", () => ({
  CodeSnippetsTab: () => <div data-testid="snippets">Snippets Content</div>,
}));

import { HelpPanel } from "./HelpPanel";

describe("HelpPanel", () => {
  it("renders all tab buttons", () => {
    render(() => <HelpPanel />);
    expect(screen.getByText("Guide")).toBeTruthy();
    expect(screen.getByText("Reference")).toBeTruthy();
    expect(screen.getByText("Code Snippets")).toBeTruthy();
  });

  it("shows Guide tab as active by default", () => {
    render(() => <HelpPanel />);
    const btn = screen.getByText("Guide");
    expect(btn).toHaveClass("active");
  });

  it("switches to another tab on click", () => {
    render(() => <HelpPanel />);
    const refBtn = screen.getByText("Reference");
    fireEvent.click(refBtn);
    expect(refBtn).toHaveClass("active");

    const guideBtn = screen.getByText("Guide");
    expect(guideBtn).not.toHaveClass("active");
  });

  it("renders with help-panel class", () => {
    const { container } = render(() => <HelpPanel />);
    expect(container.querySelector(".help-panel")).toBeTruthy();
  });

  it("renders custom tabs when provided via props", () => {
    const customTabs = [
      { id: "custom-1", name: "Alpha", content: () => <div>Alpha content</div> },
      { id: "custom-2", name: "Beta", content: () => <div>Beta content</div> },
    ];
    render(() => <HelpPanel tabs={customTabs} />);
    expect(screen.getByText("Alpha")).toBeTruthy();
    expect(screen.getByText("Beta")).toBeTruthy();
    // Default tabs should NOT be present
    expect(screen.queryByText("Guide")).toBeNull();
  });
});
