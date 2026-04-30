import { render } from "@solidjs/testing-library";
import { createSignal } from "solid-js";
import { describe, it, expect } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders the container and progress bar elements", () => {
    const { container } = render(() => <ProgressBar progress={0} />);
    const outer = container.querySelector("#toolbar-bar-progress-container");
    const inner = container.querySelector("#toolbar-bar-progress");
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
  });

  it("starts with scaleX(0)", () => {
    const { container } = render(() => <ProgressBar progress={0} />);
    const inner = container.querySelector(
      "#toolbar-bar-progress"
    ) as HTMLElement;
    expect(inner.style.transform).toBe("scaleX(0)");
  });

  it("updates bar value from store", async () => {
    const [progress, setProgress] = createSignal(0);
    const { container } = render(() => <ProgressBar progress={progress()} />);
    const inner = container.querySelector(
      "#toolbar-bar-progress"
    ) as HTMLElement;

    setProgress(0.75);

    expect(inner.style.transform).toBe("scaleX(0.75)");
  });

  it("clamps values between 0 and 1", () => {
    const [progress, setProgress] = createSignal(0);
    const { container } = render(() => <ProgressBar progress={progress()} />);
    const inner = container.querySelector(
      "#toolbar-bar-progress"
    ) as HTMLElement;

    setProgress(1.5);
    expect(inner.style.transform).toBe("scaleX(1)");

    setProgress(-0.5);
    expect(inner.style.transform).toBe("scaleX(0)");
  });

  it("has pointer-events none", () => {
    const { container } = render(() => <ProgressBar progress={0} />);
    const outer = container.querySelector(
      "#toolbar-bar-progress-container"
    ) as HTMLElement;
    expect(outer.style.pointerEvents).toBe("none");
  });
});
