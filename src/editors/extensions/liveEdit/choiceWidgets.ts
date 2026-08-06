import type { EditorView } from "@codemirror/view";

import {
  LiveEditBaseWidget,
  liveEditWidgetConfigFacet,
} from "./widgetBase.ts";

// ── Toggle (boolean) ────────────────────────────────────────────────────────

export class ToggleWidget extends LiveEditBaseWidget {
  protected override renderControl(wrapper: HTMLElement, view: EditorView): void {
    const pill = document.createElement("span");
    pill.className = "cm-live-edit-toggle";
    pill.setAttribute("role", "switch");
    pill.setAttribute("tabindex", "0");

    const update = (): void => {
      const on = Boolean(this.localValue);
      pill.classList.toggle("is-on", on);
      pill.classList.toggle("is-off", !on);
      pill.setAttribute("aria-checked", String(on));
      pill.textContent = on ? "● on" : "off ●";
    };
    update();

    const toggle = (): void => {
      this.localValue = !this.localValue;
      update();
      this.refreshReadout(wrapper);
      view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, this.localValue as boolean);
    };

    // §4.6.1: Cmd/Ctrl + click — reset to seed.
    pill.addEventListener("mousedown", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.metaKey || ev.ctrlKey) {
        this.localValue = this.slot.seed;
        update();
        this.refreshReadout(wrapper);
        view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, this.localValue as boolean);
        return;
      }
      toggle();
    });

    // §4.6.2: Keyboard arrows — toggle booleans.
    pill.addEventListener("keydown", (ev) => {
      if (
        ev.key === "ArrowUp" || ev.key === "ArrowDown" ||
        ev.key === "ArrowLeft" || ev.key === "ArrowRight" ||
        ev.key === " " || ev.key === "Enter"
      ) {
        ev.preventDefault();
        toggle();
      }
    });

    // §4.6.1: Right-click — context menu.
    pill.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      wrapper.dispatchEvent(
        new CustomEvent("liveEditContextMenu", {
          detail: { slotId: this.slot.id, x: ev.clientX, y: ev.clientY },
          bubbles: true,
        }),
      );
    });

    wrapper.appendChild(pill);
  }

  protected override renderReadout(): void {
    // Toggle's pill renders its own `on`/`off` label (see toDOM: "● on" /
    // "off ●"), so it IS the readout for booleans. spec §4.2.1 carves out
    // this exception: a separate adjacent on/off string would be redundant
    // and visually busy on a single line. Intentionally a no-op.
  }
}

// ── Picker (keyword enum) ───────────────────────────────────────────────────

export class PickerWidget extends LiveEditBaseWidget {
  protected override renderControl(wrapper: HTMLElement, view: EditorView): void {
    const row = document.createElement("span");
    row.className = "cm-live-edit-picker";
    row.setAttribute("role", "listbox");
    row.setAttribute("tabindex", "0");

    const options =
      this.slot.options && this.slot.options.length > 0
        ? this.slot.options
        : [String(this.slot.value)];

    /** Update all segments to reflect the current localValue. */
    const refreshSegments = (): void => {
      for (const child of Array.from(row.children) as HTMLElement[]) {
        const childOpt = child.dataset.option ?? "";
        const isSelected = childOpt === String(this.localValue);
        child.classList.toggle("is-selected", isSelected);
        child.setAttribute("aria-selected", String(isSelected));
        child.textContent = `:${childOpt} ${isSelected ? "●" : "○"}`;
      }
    };

    /** Select an option by value. */
    const selectOption = (opt: string): void => {
      this.localValue = opt;
      refreshSegments();
      this.refreshReadout(wrapper);
      view.state.facet(liveEditWidgetConfigFacet).onValueChange?.(this.slot.id, opt);
    };

    for (const opt of options) {
      const seg = document.createElement("span");
      seg.className = "cm-live-edit-picker-option";
      seg.dataset.option = opt;
      const filled = opt === String(this.localValue);
      seg.classList.toggle("is-selected", filled);
      seg.textContent = `:${opt} ${filled ? "●" : "○"}`;
      seg.setAttribute("role", "option");
      seg.setAttribute("aria-selected", String(filled));

      // §4.6.1: Cmd/Ctrl + click — reset to seed.
      seg.addEventListener("mousedown", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        if (ev.metaKey || ev.ctrlKey) {
          selectOption(String(this.slot.seed));
          return;
        }
        selectOption(opt);
      });

      row.appendChild(seg);
    }

    // §4.6.2: Keyboard arrows — cycle enums.
    row.addEventListener("keydown", (ev) => {
      const currentIdx = options.indexOf(String(this.localValue));
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const nextIdx = (currentIdx + 1) % options.length;
        selectOption(options[nextIdx]);
      } else if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") {
        ev.preventDefault();
        const prevIdx = (currentIdx - 1 + options.length) % options.length;
        selectOption(options[prevIdx]);
      }
    });

    // §4.6.1: Scroll wheel — cycle options.
    row.addEventListener("wheel", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      const currentIdx = options.indexOf(String(this.localValue));
      const direction = ev.deltaY < 0 ? 1 : -1;
      const nextIdx = (currentIdx + direction + options.length) % options.length;
      selectOption(options[nextIdx]);
    });

    // §4.6.1: Right-click — context menu.
    row.addEventListener("contextmenu", (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      wrapper.dispatchEvent(
        new CustomEvent("liveEditContextMenu", {
          detail: { slotId: this.slot.id, x: ev.clientX, y: ev.clientY },
          bubbles: true,
        }),
      );
    });

    wrapper.appendChild(row);
  }

  protected override renderReadout(wrapper: HTMLElement): void {
    // For pickers the segmented row already shows the current option clearly.
    // Skip the readout to avoid visual noise (cf. ToggleWidget).
    void wrapper;
  }
}
