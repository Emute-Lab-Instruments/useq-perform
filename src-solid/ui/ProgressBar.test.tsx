import { render } from "@solidjs/testing-library";
import { describe, it, expect } from "vitest";
import { ProgressBar } from "./ProgressBar";

describe("ProgressBar", () => {
  it("renders the container and progress bar elements", () => {
    const { container } = render(() => <ProgressBar />);
    const outer = container.querySelector("#toolbar-bar-progress-container");
    const inner = container.querySelector("#toolbar-bar-progress");
    expect(outer).toBeTruthy();
    expect(inner).toBeTruthy();
  });

  it("starts with scaleX(0)", () => {
    const { container } = render(() => <ProgressBar />);
    const inner = container.querySelector(
      "#toolbar-bar-progress"
    ) as HTMLElement;
    expect(inner.style.transform).toBe("scaleX(0)");
  });

  it("updates bar value from custom event", async () => {
    const { container } = render(() => <ProgressBar />);
    const inner = container.querySelector(
      "#toolbar-bar-progress"
    ) as HTMLElement;

    window.dispatchEvent(
      new CustomEvent("useq-visualisation-changed", {
        detail: { bar: 0.75 },
      })
    );

    // SolidJS updates are synchronous
    expect(inner.style.transform).toBe("scaleX(0.75)");
  });

  it("clamps values between 0 and 1", () => {
    const { container } = render(() => <ProgressBar />);
    const inner = container.querySelector(
      "#toolbar-bar-progress"
    ) as HTMLElement;

    window.dispatchEvent(
      new CustomEvent("useq-visualisation-changed", {
        detail: { bar: 1.5 },
      })
    );
    expect(inner.style.transform).toBe("scaleX(1)");

    window.dispatchEvent(
      new CustomEvent("useq-visualisation-changed", {
        detail: { bar: -0.5 },
      })
    );
    expect(inner.style.transform).toBe("scaleX(0)");
  });

  it("has pointer-events none", () => {
    const { container } = render(() => <ProgressBar />);
    const outer = container.querySelector(
      "#toolbar-bar-progress-container"
    ) as HTMLElement;
    expect(outer.style.pointerEvents).toBe("none");
  });
});
