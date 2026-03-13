import { render, screen } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  DoubleRadialPicker,
  type PickerCategory,
} from "./DoubleRadialPicker";
import { _resetForTesting } from "./overlayManager";

const sampleCategories: PickerCategory[] = [
  {
    label: "Favorites",
    id: "favorites",
    items: [
      { label: "+", insertText: "(+ )" },
      { label: "-", insertText: "(- )" },
    ],
  },
  {
    label: "Maths",
    id: "maths",
    items: [
      { label: "*", insertText: "(* )" },
      { label: "/", insertText: "(/ )" },
      { label: "mod", insertText: "(mod )" },
    ],
  },
];

describe("DoubleRadialPicker", () => {
  beforeEach(() => {
    _resetForTesting();
    document.body.style.overflow = "";
  });

  afterEach(() => {
    _resetForTesting();
    document.body.style.overflow = "";
    // Clean up any overlay elements
    document
      .querySelectorAll(".picker-menu-overlay")
      .forEach((el) => el.remove());
  });

  it("renders the overlay and dialog", () => {
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(container.querySelector(".picker-menu-overlay")).toBeTruthy();
    expect(container.querySelector('[role="dialog"]')).toBeTruthy();
  });

  it("renders a title when provided", () => {
    render(() => (
      <DoubleRadialPicker
        title="Pick a function"
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(screen.getByText("Pick a function")).toBeTruthy();
  });

  it("renders Primary and Context headings", () => {
    render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(screen.getByText("Primary")).toBeTruthy();
    expect(screen.getByText("Context")).toBeTruthy();
  });

  it("renders two radial menus", () => {
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    const radials = container.querySelectorAll(".radial-menu");
    expect(radials.length).toBe(2);
  });

  it("renders category labels in left menu", () => {
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    // Category labels should be visible as SVG text elements
    const textElements = container.querySelectorAll("text");
    const texts = Array.from(textElements).map((el) => el.textContent);
    expect(texts).toContain("Favorites");
    expect(texts).toContain("Maths");
  });

  it("shows item labels from the first category by default", () => {
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    const textElements = container.querySelectorAll("text");
    const texts = Array.from(textElements).map((el) => el.textContent);
    // First category items: + and -
    expect(texts).toContain("+");
    expect(texts).toContain("-");
  });

  it("calls onCancel when cancel event is dispatched", () => {
    const onCancel = vi.fn();
    render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={onCancel}
      />
    ));
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "cancel" },
      })
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("calls onSelect when select event is dispatched", () => {
    const onSelect = vi.fn();
    render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={onSelect}
        onCancel={() => {}}
      />
    ));
    // Default selection is category 0 (Favorites), item 0 (+)
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "select" },
      })
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].label).toBe("+");
  });

  it("navigates categories with D-pad left/right", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={onSelect}
        onCancel={() => {}}
      />
    ));

    // Navigate right to Maths category
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { direction: "right" },
      })
    );

    // Now select -- should pick from Maths category
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "select" },
      })
    );

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].label).toBe("*");
  });

  it("navigates items with D-pad up/down", () => {
    const onSelect = vi.fn();
    render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={onSelect}
        onCancel={() => {}}
      />
    ));

    // Default: Favorites category, item 0 (+)
    // Navigate down to item 1 (-)
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { direction: "down" },
      })
    );

    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "select" },
      })
    );

    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect.mock.calls[0][0].label).toBe("-");
  });

  it("calls onCancel when clicking overlay background", () => {
    const onCancel = vi.fn();
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={onCancel}
      />
    ));

    const overlay = container.querySelector(".picker-menu-overlay")!;
    // Click on the overlay itself (not a child)
    overlay.dispatchEvent(
      new MouseEvent("click", { bubbles: true })
    );
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("uses the shared overlay manager for Escape and scroll lock", () => {
    const onCancel = vi.fn();
    const { unmount } = render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={onCancel}
      />
    ));

    expect(document.body.style.overflow).toBe("hidden");

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledOnce();

    unmount();
    expect(document.body.style.overflow).toBe("");
  });

  it("handles empty categories gracefully", () => {
    const { container } = render(() => (
      <DoubleRadialPicker
        categories={[]}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    // Should still render without crashing
    expect(container.querySelector(".picker-menu-overlay")).toBeTruthy();
  });

  it("renders gamepad hint text", () => {
    render(() => (
      <DoubleRadialPicker
        categories={sampleCategories}
        onSelect={() => {}}
        onCancel={() => {}}
      />
    ));
    expect(
      screen.getByText(/Gamepad: Left stick = category/)
    ).toBeTruthy();
  });
});
