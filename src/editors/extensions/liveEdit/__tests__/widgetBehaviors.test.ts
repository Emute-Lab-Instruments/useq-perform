import { describe, expect, it, vi } from "vitest";
import type { EditorView } from "@codemirror/view";

import type { LiveEditSlot } from "../../../../contracts/liveEdit.ts";
import { PickerWidget, ToggleWidget } from "../choiceWidgets.ts";
import { KnobWidget, SliderWidget } from "../numericWidgets.ts";

function slot(overrides: Partial<LiveEditSlot>): LiveEditSlot {
  return {
    id: "slot-1",
    kind: "numeric",
    seed: 0.5,
    value: 0.5,
    min: 0,
    max: 1,
    step: 0.1,
    precision: 2,
    state: "idle",
    range: { from: 0, to: 1 },
    ...overrides,
  };
}

function viewWith(onValueChange = vi.fn()): {
  view: EditorView;
  onValueChange: ReturnType<typeof vi.fn>;
} {
  return {
    view: {
      state: {
        facet: () => ({ onValueChange }),
      },
    } as unknown as EditorView,
    onValueChange,
  };
}

describe("live-edit widget behavior modules", () => {
  it("renders numeric knob and slider controls with their current values", () => {
    const { view } = viewWith();
    const numeric = slot({ modified: true });

    const knob = new KnobWidget(numeric).toDOM(view);
    const slider = new SliderWidget(numeric).toDOM(view);

    expect(knob.querySelector(".cm-live-edit-knob")).not.toBeNull();
    expect(slider.querySelector(".cm-live-edit-slider")).not.toBeNull();
    expect(knob.querySelector(".cm-live-edit-readout")?.textContent).toBe("0.50");
    expect(slider.querySelector(".cm-live-edit-readout")?.textContent).toBe("0.50");
  });

  it("toggles boolean values through the editor-local value sink", () => {
    const { view, onValueChange } = viewWith();
    const root = new ToggleWidget(slot({
      kind: "boolean",
      seed: false,
      value: false,
    })).toDOM(view);

    root.querySelector<HTMLElement>(".cm-live-edit-toggle")?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );

    expect(onValueChange).toHaveBeenCalledWith("slot-1", true);
  });

  it("selects keyword options through the same value sink", () => {
    const { view, onValueChange } = viewWith();
    const root = new PickerWidget(slot({
      kind: "keyword",
      seed: "up",
      value: "up",
      options: ["up", "down"],
    })).toDOM(view);

    root.querySelector<HTMLElement>('[data-option="down"]')?.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true }),
    );

    expect(onValueChange).toHaveBeenCalledWith("slot-1", "down");
  });
});
