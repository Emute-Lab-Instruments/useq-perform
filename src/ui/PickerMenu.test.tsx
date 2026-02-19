import { render, fireEvent } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { PickerMenu, NumberPickerMenu } from "./PickerMenu";
import { HierarchicalPickerMenu } from "./HierarchicalPickerMenu";
import type { PickerMenuItem } from "./PickerMenu";
import type { HierarchicalCategory } from "./HierarchicalPickerMenu";
import { _resetForTesting } from "./overlayManager";

afterEach(() => {
  // Reset overlay manager state so tests don't bleed into each other
  _resetForTesting();
});

// ---------------------------------------------------------------------------
// PickerMenu
// ---------------------------------------------------------------------------
describe("PickerMenu", () => {
  const sampleItems: PickerMenuItem[] = [
    { label: "Alpha", value: "a" },
    { label: "Beta", value: "b" },
    { label: "Gamma", value: "c" },
    { label: "Delta", value: "d" },
  ];

  it("renders items with correct labels", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} />
    ));
    const itemEls = container.querySelectorAll(".picker-menu-item");
    expect(itemEls.length).toBe(4);
    expect(itemEls[0].textContent).toBe("Alpha");
    expect(itemEls[1].textContent).toBe("Beta");
    expect(itemEls[2].textContent).toBe("Gamma");
    expect(itemEls[3].textContent).toBe("Delta");
  });

  it("shows title when provided", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} title="Pick one" onSelect={() => {}} />
    ));
    const title = container.querySelector(".picker-menu-title");
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe("Pick one");
  });

  it("hides title when not provided", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} />
    ));
    expect(container.querySelector(".picker-menu-title")).toBeNull();
  });

  it("uses grid class by default", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} />
    ));
    const itemsContainer = container.querySelector(".picker-menu-items");
    expect(itemsContainer?.classList.contains("grid")).toBe(true);
    expect(itemsContainer?.classList.contains("vertical")).toBe(false);
  });

  it("uses vertical class when layout is vertical", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} layout="vertical" onSelect={() => {}} />
    ));
    const itemsContainer = container.querySelector(".picker-menu-items");
    expect(itemsContainer?.classList.contains("vertical")).toBe(true);
    expect(itemsContainer?.classList.contains("grid")).toBe(false);
  });

  it("sets active item at computed initial index", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} initialIndex={2} onSelect={() => {}} />
    ));
    const itemEls = container.querySelectorAll(".picker-menu-item");
    expect(itemEls[2].classList.contains("active")).toBe(true);
    expect(itemEls[0].classList.contains("active")).toBe(false);
  });

  it("defaults initialIndex to middle when not provided", () => {
    const { container } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} />
    ));
    // 4 items, floor(4/2) = 2
    const itemEls = container.querySelectorAll(".picker-menu-item");
    expect(itemEls[2].classList.contains("active")).toBe(true);
  });

  it("does not crash with empty items array", () => {
    const { container } = render(() => (
      <PickerMenu items={[]} onSelect={() => {}} />
    ));
    expect(container.querySelectorAll(".picker-menu-item").length).toBe(0);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} onClose={onClose} />
    ));
    // Escape is handled by the overlay manager which listens on document
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onSelect with active item when Enter is pressed", () => {
    const onSelect = vi.fn();
    render(() => (
      <PickerMenu
        items={sampleItems}
        initialIndex={1}
        onSelect={onSelect}
      />
    ));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(sampleItems[1], 1);
  });

  it("calls onClose when overlay is clicked", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} onClose={onClose} />
    ));
    const overlay = container.querySelector(".picker-menu-overlay")!;
    // Click directly on the overlay (target === currentTarget)
    fireEvent.click(overlay);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does not call onClose when clicking an item inside the overlay", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    const { container } = render(() => (
      <PickerMenu
        items={sampleItems}
        onSelect={onSelect}
        onClose={onClose}
      />
    ));
    const item = container.querySelector(".picker-menu-item")!;
    fireEvent.click(item);
    // onClose is called as part of selectItem, but overlay click handler should not fire
    // selectItem calls onClose once
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it("navigates with ArrowUp/ArrowDown in vertical mode", () => {
    const { container } = render(() => (
      <PickerMenu
        items={sampleItems}
        layout="vertical"
        initialIndex={0}
        onSelect={() => {}}
      />
    ));

    // In vertical layout, ArrowDown moves to (activeIdx - 1 + len) % len
    // Starting at 0: (0 - 1 + 4) % 4 = 3
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
    let items = container.querySelectorAll(".picker-menu-item");
    expect(items[3].classList.contains("active")).toBe(true);

    // ArrowUp moves to (activeIdx + 1) % len
    // From 3: (3 + 1) % 4 = 0
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp" }));
    items = container.querySelectorAll(".picker-menu-item");
    expect(items[0].classList.contains("active")).toBe(true);
  });

  it("handles gamepad select event", () => {
    const onSelect = vi.fn();
    render(() => (
      <PickerMenu
        items={sampleItems}
        initialIndex={1}
        onSelect={onSelect}
      />
    ));
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "select" },
      })
    );
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(sampleItems[1], 1);
  });

  it("handles gamepad cancel event", () => {
    const onClose = vi.fn();
    render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} onClose={onClose} />
    ));
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "cancel" },
      })
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("removes event listeners after unmount", () => {
    const onClose = vi.fn();
    const { unmount } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} onClose={onClose} />
    ));
    unmount();

    // After unmount, keydown and gamepadpickerinput should be removed
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    window.dispatchEvent(
      new CustomEvent("gamepadpickerinput", {
        detail: { action: "cancel" },
      })
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sets document.body.style.overflow to hidden on mount", () => {
    document.body.style.overflow = "";
    render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} />
    ));
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("restores document.body.style.overflow on unmount", () => {
    const { unmount } = render(() => (
      <PickerMenu items={sampleItems} onSelect={() => {}} />
    ));
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).toBe("");
  });
});

// ---------------------------------------------------------------------------
// NumberPickerMenu
// ---------------------------------------------------------------------------
describe("NumberPickerMenu", () => {
  it("renders with clamped initial value", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={5}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(Number(input.value)).toBe(5);
  });

  it("clamps initial value to max", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={20}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(10);
  });

  it("clamps initial value to min", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={-5}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(0);
  });

  it("increments value when + button is clicked", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={3}
        step={2}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const buttons = container.querySelectorAll(".number-picker-btn");
    // Second button is +
    const plusBtn = buttons[1];
    fireEvent.click(plusBtn);
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(5);
  });

  it("decrements value when - button is clicked", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={5}
        step={2}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const buttons = container.querySelectorAll(".number-picker-btn");
    // First button is -
    const minusBtn = buttons[0];
    fireEvent.click(minusBtn);
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(3);
  });

  it("clamps value within min/max on increment", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={9}
        step={5}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const buttons = container.querySelectorAll(".number-picker-btn");
    fireEvent.click(buttons[1]); // +
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(10);
  });

  it("clamps value within min/max on decrement", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        initialValue={1}
        step={5}
        min={0}
        max={10}
        onSelect={() => {}}
      />
    ));
    const buttons = container.querySelectorAll(".number-picker-btn");
    fireEvent.click(buttons[0]); // -
    const input = container.querySelector(
      ".number-picker-input"
    ) as HTMLInputElement;
    expect(Number(input.value)).toBe(0);
  });

  it("calls onSelect with current value when Enter is pressed", () => {
    const onSelect = vi.fn();
    render(() => (
      <NumberPickerMenu
        initialValue={7}
        min={0}
        max={10}
        onSelect={onSelect}
      />
    ));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(onSelect).toHaveBeenCalledWith(7);
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    render(() => (
      <NumberPickerMenu
        initialValue={0}
        onSelect={() => {}}
        onClose={onClose}
      />
    ));
    // Escape is handled by the overlay manager which listens on document
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("shows title", () => {
    const { container } = render(() => (
      <NumberPickerMenu
        title="Volume"
        initialValue={0}
        onSelect={() => {}}
      />
    ));
    const title = container.querySelector(".picker-menu-title");
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe("Volume");
  });

  it("shows default title when not provided", () => {
    const { container } = render(() => (
      <NumberPickerMenu initialValue={0} onSelect={() => {}} />
    ));
    const title = container.querySelector(".picker-menu-title");
    expect(title).toBeTruthy();
    expect(title!.textContent).toBe("Pick a number");
  });
});

// ---------------------------------------------------------------------------
// HierarchicalPickerMenu
// ---------------------------------------------------------------------------
describe("HierarchicalPickerMenu", () => {
  const categories: HierarchicalCategory[] = [
    {
      label: "Fruits",
      id: "fruits",
      items: [
        { label: "Apple", value: "apple" },
        { label: "Banana", value: "banana" },
      ],
    },
    {
      label: "Veggies",
      id: "veggies",
      items: [
        { label: "Carrot", value: "carrot" },
        { label: "Num", value: "num", special: "number" },
      ],
    },
  ];

  it("shows categories first", () => {
    const { container } = render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        onSelect={() => {}}
      />
    ));
    const items = container.querySelectorAll(".picker-menu-item");
    expect(items.length).toBe(2);
    expect(items[0].textContent).toBe("Fruits");
    expect(items[1].textContent).toBe("Veggies");
  });

  it("drills down into category items on selection", async () => {
    const { container } = render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        onSelect={() => {}}
      />
    ));

    // Select the first category "Fruits" by clicking it
    const categoryItems = container.querySelectorAll(".picker-menu-item");
    fireEvent.click(categoryItems[0]);

    // Now we should see the items of the Fruits category
    const drillItems = container.querySelectorAll(".picker-menu-item");
    expect(drillItems.length).toBe(2);
    expect(drillItems[0].textContent).toBe("Apple");
    expect(drillItems[1].textContent).toBe("Banana");
  });

  it("shows NumberPickerMenu for items with special=number", () => {
    const { container } = render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        onSelect={() => {}}
      />
    ));

    // Select "Veggies" category
    const categoryItems = container.querySelectorAll(".picker-menu-item");
    fireEvent.click(categoryItems[1]);

    // Now select the "Num" item (with special="number")
    const veggieItems = container.querySelectorAll(".picker-menu-item");
    // veggieItems[0] = "Carrot", veggieItems[1] = "Num"
    fireEvent.click(veggieItems[1]);

    // Now the NumberPickerMenu should be shown
    const numberInput = container.querySelector(".number-picker-input");
    expect(numberInput).toBeTruthy();
  });

  it("calls onClose when closing at category level", () => {
    const onClose = vi.fn();
    render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        onSelect={() => {}}
        onClose={onClose}
      />
    ));
    // Press Escape at category level (overlay manager listens on document)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("calls onClose when closing at items level", () => {
    const onClose = vi.fn();
    const { container } = render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        onSelect={() => {}}
        onClose={onClose}
      />
    ));

    // Drill into Fruits -- the inner PickerMenu's selectItem calls onClose
    // once as part of category selection
    const categoryItems = container.querySelectorAll(".picker-menu-item");
    fireEvent.click(categoryItems[0]);
    const callsAfterDrill = onClose.mock.calls.length;

    // Now press Escape at items level -- should call onClose again (overlay manager listens on document)
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onClose.mock.calls.length).toBe(callsAfterDrill + 1);
  });

  it("shows title with category name when drilled down", () => {
    const { container } = render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        title="Build"
        onSelect={() => {}}
      />
    ));

    // At category level, title should be "Build"
    let title = container.querySelector(".picker-menu-title");
    expect(title?.textContent).toBe("Build");

    // Drill into Fruits
    const categoryItems = container.querySelectorAll(".picker-menu-item");
    fireEvent.click(categoryItems[0]);

    title = container.querySelector(".picker-menu-title");
    expect(title?.textContent).toBe("Build: Fruits");
  });

  it("calls onSelect with the chosen item", () => {
    const onSelect = vi.fn();
    const { container } = render(() => (
      <HierarchicalPickerMenu
        categories={categories}
        onSelect={onSelect}
      />
    ));

    // Drill into Fruits
    fireEvent.click(container.querySelectorAll(".picker-menu-item")[0]);

    // Select Apple
    fireEvent.click(container.querySelectorAll(".picker-menu-item")[0]);

    expect(onSelect).toHaveBeenCalledOnce();
    const arg = onSelect.mock.calls[0][0];
    expect(arg.label).toBe("Apple");
    expect(arg.value).toBe("apple");
  });
});
