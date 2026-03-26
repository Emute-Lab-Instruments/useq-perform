import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { ConfigurationManagement } from "./ConfigurationManagement";

describe("ConfigurationManagement", () => {
  it("does not render outside devmode", () => {
    const { container } = render(() => <ConfigurationManagement devmode={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Configuration Management")).toBeNull();
  });

  it("renders the dev-only configuration controls in devmode", () => {
    render(() => <ConfigurationManagement devmode />);

    // Title is always visible even when section is collapsed
    expect(screen.getByText("Configuration Management")).toBeTruthy();

    // Expand the section to reveal content
    screen.getByText("Configuration Management").closest("button")?.click();

    expect(screen.getByText("Internal dev tooling for exporting or importing configuration files. In dev mode with the config server running, configurations can also be written directly to the source tree.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "💾 Export Configuration" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "📥 Import Configuration" })).toBeTruthy();
  });
});
