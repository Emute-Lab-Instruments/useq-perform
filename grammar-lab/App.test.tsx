import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => cleanup());

describe("Grammar Lab artifact", () => {
  it("performs the same semantic etude through the shifted keyboard surface", () => {
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Move forward: Shift+ArrowRight" }));

    expect(screen.getByRole("heading", { name: "Same meaning. Different motion." })).toBeInTheDocument();
    expect(screen.getByText("(a1 (from-list [0.2 0.4 0.8 0.6] bar))")).toBeInTheDocument();
    expect(screen.getByText("Shift+ArrowRight", { selector: ".causal-pipeline strong" })).toBeInTheDocument();
  });

  it("derives the virtual gamepad surface from the active profile", () => {
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "gamepad", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Move forward: LB + D-pad →" }));

    expect(screen.getByRole("heading", { name: "Same meaning. Different motion." })).toBeInTheDocument();
    expect(screen.getByText("LB + D-pad →", { selector: ".causal-pipeline strong" })).toBeInTheDocument();
  });

  it("keeps the last good signal visible while a structural hole is staged", () => {
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Make a hole: Shift+Backspace" }));

    expect(screen.getByText("holding last good")).toBeInTheDocument();
    expect(screen.getByText("(a1 (from-list [0.2 □ 0.4 0.6] bar))")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Stepped CV signal with values 0.2, 0.8, 0.4, 0.6" })).toBeInTheDocument();
  });
});
