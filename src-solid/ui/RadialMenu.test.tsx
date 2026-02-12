import { render } from "@solidjs/testing-library";
import { describe, it, expect, vi } from "vitest";
import { RadialMenu } from "./RadialMenu";

describe("RadialMenu", () => {
  it("renders an SVG element", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={4}
        activeSegment={null}
        onHoverSegment={() => {}}
      />
    ));
    const svg = container.querySelector("svg");
    expect(svg).toBeTruthy();
  });

  it("renders the correct number of segment paths", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={6}
        activeSegment={null}
        onHoverSegment={() => {}}
      />
    ));
    // Each segment has a <g> containing a <path>; there are also label <text> elements
    const paths = container.querySelectorAll("g > path");
    // 6 segments = 6 base paths (active segment adds an overlay path)
    expect(paths.length).toBe(6);
  });

  it("renders labels for each segment", () => {
    const labels = ["A", "B", "C", "D"];
    const { container } = render(() => (
      <RadialMenu
        segmentCount={4}
        activeSegment={null}
        onHoverSegment={() => {}}
        labels={labels}
      />
    ));
    const textElements = container.querySelectorAll("text");
    expect(textElements.length).toBe(4);
    const texts = Array.from(textElements).map((el) => el.textContent);
    expect(texts).toEqual(labels);
  });

  it("uses numeric labels when none provided", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={3}
        activeSegment={null}
        onHoverSegment={() => {}}
      />
    ));
    const textElements = container.querySelectorAll("text");
    const texts = Array.from(textElements).map((el) => el.textContent);
    expect(texts).toEqual(["1", "2", "3"]);
  });

  it("renders an overlay path for the active segment", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={4}
        activeSegment={1}
        onHoverSegment={() => {}}
      />
    ));
    // Active segment adds an overlay path, so total paths = segments + 1
    const paths = container.querySelectorAll("g > path");
    expect(paths.length).toBe(5); // 4 base + 1 overlay
  });

  it("applies disabled class", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={3}
        activeSegment={null}
        onHoverSegment={() => {}}
        disabled={true}
      />
    ));
    const wrapper = container.querySelector(".radial-menu");
    expect(wrapper?.classList.contains("is-disabled")).toBe(true);
  });

  it("applies is-active class when a segment is active", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={3}
        activeSegment={0}
        onHoverSegment={() => {}}
      />
    ));
    const wrapper = container.querySelector(".radial-menu");
    expect(wrapper?.classList.contains("is-active")).toBe(true);
  });

  it("respects custom size", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={3}
        activeSegment={null}
        onHoverSegment={() => {}}
        size={200}
      />
    ));
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("width")).toBe("200");
    expect(svg?.getAttribute("height")).toBe("200");
  });

  it("renders a center dot", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={3}
        activeSegment={null}
        onHoverSegment={() => {}}
      />
    ));
    const circle = container.querySelector("circle");
    expect(circle).toBeTruthy();
  });

  it("truncates long labels to 10 chars + ellipsis", () => {
    const { container } = render(() => (
      <RadialMenu
        segmentCount={1}
        activeSegment={null}
        onHoverSegment={() => {}}
        labels={["This is a very long label"]}
      />
    ));
    const text = container.querySelector("text");
    // "This is a " (10 chars) + "..."
    expect(text?.textContent?.length).toBeLessThanOrEqual(11);
  });

  it("calls onSelectSegment on click when active", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <RadialMenu
        segmentCount={4}
        activeSegment={2}
        onHoverSegment={() => {}}
        onSelectSegment={onSelect}
      />
    ));
    const svg = container.querySelector("svg")!;
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("does not call onSelectSegment on click when disabled", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <RadialMenu
        segmentCount={4}
        activeSegment={2}
        onHoverSegment={() => {}}
        onSelectSegment={onSelect}
        disabled={true}
      />
    ));
    const svg = container.querySelector("svg")!;
    svg.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
