import { render } from "@solidjs/testing-library";
import { describe, expect, it } from "vitest";

import { LoadingState } from "./LoadingState";

describe("LoadingState", () => {
  it("renders a polite status region with the given label", () => {
    const { container } = render(() => (
      <LoadingState label="Loading reference…" />
    ));

    const el = container.querySelector(".loading-state");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("role")).toBe("status");
    expect(el?.getAttribute("aria-live")).toBe("polite");
    expect(el?.textContent).toBe("Loading reference…");
  });

  it("falls back to a default label", () => {
    const { container } = render(() => <LoadingState />);

    expect(container.querySelector(".loading-state")?.textContent).toBe(
      "Loading…",
    );
  });

  it("applies an extra context class when provided", () => {
    const { container } = render(() => (
      <LoadingState label="Loading…" class="ledger-loading" />
    ));

    const el = container.querySelector(".loading-state");
    expect(el?.classList.contains("ledger-loading")).toBe(true);
  });
});
