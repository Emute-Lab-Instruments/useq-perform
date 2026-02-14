import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";

// Mock child tabs to avoid complex dependencies (fetch, markdown, etc.)
vi.mock("./UserGuideTab", () => ({
  UserGuideTab: () => <div data-testid="user-guide">User Guide Content</div>,
}));
vi.mock("./ModuLispReferenceTab", () => ({
  ModuLispReferenceTab: () => (
    <div data-testid="reference">Reference Content</div>
  ),
}));
vi.mock("./CodeSnippetsTab", () => ({
  CodeSnippetsTab: () => <div data-testid="snippets">Snippets Content</div>,
}));
vi.mock("./KeybindingsTab", () => ({
  KeybindingsTab: () => (
    <div data-testid="keybindings">Keybindings Content</div>
  ),
}));

import { HelpPanel } from "./HelpPanel";

describe("HelpPanel", () => {
  it("renders all four tab buttons", () => {
    render(() => <HelpPanel />);
    expect(screen.getByText("User Guide")).toBeTruthy();
    expect(screen.getByText("ModuLisp Reference")).toBeTruthy();
    expect(screen.getByText("Code Snippets")).toBeTruthy();
    expect(screen.getByText("Keybindings")).toBeTruthy();
  });

  it("shows User Guide tab as active by default", () => {
    render(() => <HelpPanel />);
    const btn = screen.getByText("User Guide");
    expect(btn).toHaveClass("active");
  });

  it("switches to another tab on click", () => {
    render(() => <HelpPanel />);
    const refBtn = screen.getByText("ModuLisp Reference");
    fireEvent.click(refBtn);
    expect(refBtn).toHaveClass("active");

    const guideBtn = screen.getByText("User Guide");
    expect(guideBtn).not.toHaveClass("active");
  });

  it("renders with help-panel class", () => {
    const { container } = render(() => <HelpPanel />);
    expect(container.querySelector(".help-panel")).toBeTruthy();
  });
});
