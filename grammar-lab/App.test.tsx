import { cleanup, fireEvent, render, screen } from "@solidjs/testing-library";
import { afterEach, describe, expect, it } from "vitest";
import App from "./App";

afterEach(() => cleanup());

describe("Grammar Lab artifact", () => {
  it("performs the same semantic etude through the shifted keyboard surface", () => {
    const { container } = render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Move forward: Shift+ArrowRight" }));

    expect(screen.getByRole("heading", { name: "Same meaning. Different motion." })).toBeInTheDocument();
    expect(screen.getByText("(a1 (from-list [0.2 0.4 0.8 0.6] bar))")).toBeInTheDocument();
    expect(screen.getByText("Shift+ArrowRight", { selector: ".causal-pipeline strong" })).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Stepped CV signal/ })).toHaveAttribute(
      "data-focused-step",
      "3",
    );
    expect(container.querySelector(".beat-cell-focused")).toHaveAttribute("data-step", "3");
  });

  it("mirrors structural focus in the waveform region and beat overview", () => {
    const { container } = render(() => <App />);
    const waveform = screen.getByRole("img", { name: /Stepped CV signal/ });
    const focusBand = container.querySelector(".wave-focus-band");

    expect(waveform).toHaveAttribute("data-focused-step", "2");
    expect(focusBand).toHaveAttribute("data-step", "2");
    expect(focusBand).toHaveAttribute("x", "160");
    expect(container.querySelector(".beat-cell-focused")).toHaveAttribute("data-step", "2");

    fireEvent.click(screen.getByRole("button", { name: "Step 4, value 0.6" }));

    expect(waveform).toHaveAttribute("data-focused-step", "4");
    expect(focusBand).toHaveAttribute("data-step", "4");
    expect(focusBand).toHaveAttribute("x", "480");
    expect(container.querySelector(".beat-cell-focused")).toHaveAttribute("data-step", "4");
    expect(screen.getByText(/focus link · step 4 · live 0\.6/i)).toBeInTheDocument();
  });

  it("derives the virtual gamepad surface from the active profile", () => {
    render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "gamepad", exact: true }));
    fireEvent.click(screen.getByRole("button", { name: "Move forward: LB + D-pad →" }));

    expect(screen.getByRole("heading", { name: "Same meaning. Different motion." })).toBeInTheDocument();
    expect(screen.getByText("LB + D-pad →", { selector: ".causal-pipeline strong" })).toBeInTheDocument();
  });

  it("keeps the last good signal visible while a structural hole is staged", () => {
    const { container } = render(() => <App />);

    fireEvent.click(screen.getByRole("button", { name: "Make a hole: Shift+Backspace" }));

    expect(screen.getByText("holding last good")).toBeInTheDocument();
    expect(screen.getByText("(a1 (from-list [0.2 □ 0.4 0.6] bar))")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Stepped CV signal with values 0.2, 0.8, 0.4, 0.6" })).toBeInTheDocument();
    expect(container.querySelector(".wave-focus-band")).toHaveClass("wave-focus-band-holding");
    expect(container.querySelector(".beat-cell-focused")).toHaveClass(
      "beat-cell-focused-holding",
    );
  });
});
