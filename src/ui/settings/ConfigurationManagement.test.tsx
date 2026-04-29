import { render, screen } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";
import { ConfigurationManagement } from "./ConfigurationManagement";

describe("ConfigurationManagement", () => {
  it("does not render outside devmode", () => {
    const { container } = render(() => <ConfigurationManagement devmode={false} />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Developer Tools")).toBeNull();
  });

  it("renders the dev-only promote-to-defaults control in devmode", () => {
    render(() => <ConfigurationManagement devmode />);

    // Title is always visible even when section is collapsed
    expect(screen.getByText("Developer Tools")).toBeTruthy();

    // Expand the section to reveal content
    screen.getByText("Developer Tools").closest("button")?.click();

    expect(screen.getByRole("button", { name: "Promote to Defaults" })).toBeTruthy();
  });
});
