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
});
