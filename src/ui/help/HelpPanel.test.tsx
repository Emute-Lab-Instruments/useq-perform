import { render, screen, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";

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
vi.mock("./ledger/LedgerTab", () => ({
  LedgerTab: () => <div data-testid="ledger">Ledger Content</div>,
}));

import { HelpPanel } from "./HelpPanel";
import { setDevmodeOverride } from "../settings/devmodeContext";

afterEach(() => setDevmodeOverride(null));

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

// engine-ledger.md §1.3 / §5.1 — "Devmode on → Help shows the Ledger tab;
// devmode off → no trace of it."
describe("HelpPanel — Engine Ledger devmode gate", () => {
  it("leaves no trace of the Ledger tab when devmode is off", () => {
    setDevmodeOverride(false);
    const { container } = render(() => <HelpPanel />);
    expect(screen.queryByText("Engine Ledger")).toBeNull();
    expect(screen.queryByTestId("ledger")).toBeNull();
    // Not merely hidden — no element for it exists at all.
    expect(container.querySelector("#panel-help-tab-ledger")).toBeNull();
    expect(container.textContent).not.toContain("Ledger");
  });

  it("shows the Ledger tab when devmode is on", () => {
    setDevmodeOverride(true);
    render(() => <HelpPanel />);
    expect(screen.getByText("Engine Ledger")).toBeTruthy();
  });

  it("keeps Guide as the default tab even with devmode on", () => {
    setDevmodeOverride(true);
    render(() => <HelpPanel />);
    expect(screen.getByText("Guide")).toHaveClass("active");
    expect(screen.getByText("Engine Ledger")).not.toHaveClass("active");
  });

  it("renders the Ledger content only once its tab is selected", () => {
    setDevmodeOverride(true);
    render(() => <HelpPanel />);
    expect(screen.queryByTestId("ledger")).toBeNull();
    fireEvent.click(screen.getByText("Engine Ledger"));
    expect(screen.getByTestId("ledger")).toBeTruthy();
  });

  it("orders the Ledger after the user-facing tabs", () => {
    setDevmodeOverride(true);
    const { container } = render(() => <HelpPanel />);
    const names = [...container.querySelectorAll(".tab-button, [role='tab'], button")]
      .map((el) => el.textContent?.trim())
      .filter((t): t is string => !!t);
    expect(names[names.length - 1]).toBe("Engine Ledger");
  });
});
