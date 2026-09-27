import { render, fireEvent, cleanup } from "@solidjs/testing-library";
import { describe, it, expect, vi, afterEach } from "vitest";
import { BpmControl, clampBpm, parseBpm, formatBpm, BPM_MIN, BPM_MAX } from "./BpmControl";

function setup(bpm = 120) {
  const onCommit = vi.fn();
  const utils = render(() => <BpmControl bpm={bpm} onCommit={onCommit} />);
  const chip = utils.container.querySelector(".bpm-display") as HTMLElement;
  return { ...utils, chip, onCommit };
}

const flush = () => new Promise<void>((resolve) => queueMicrotask(resolve));

// jsdom has no PointerEvent: build a MouseEvent of the pointer type and
// attach the pointerId the component tracks.
function pointer(el: Element, type: "pointerDown" | "pointerMove" | "pointerUp", clientY: number) {
  const event = new MouseEvent(type.toLowerCase(), {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  el.dispatchEvent(event);
  return event;
}

describe("BpmControl helpers", () => {
  it("clamps to bounds and rounds to 0.1", () => {
    expect(clampBpm(5)).toBe(BPM_MIN);
    expect(clampBpm(1000)).toBe(BPM_MAX);
    expect(clampBpm(120.44)).toBe(120.4);
  });

  it("parses finite numbers only", () => {
    expect(parseBpm(" 128 ")).toBe(128);
    expect(parseBpm("abc")).toBeNull();
    expect(parseBpm("")).toBeNull();
  });

  it("formats whole and fractional values", () => {
    expect(formatBpm(120)).toBe("120");
    expect(formatBpm(120.5)).toBe("120.5");
  });
});

describe("BpmControl", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("shows the value with spinbutton semantics", () => {
    const { chip } = setup(120);
    expect(chip.getAttribute("role")).toBe("spinbutton");
    expect(chip.getAttribute("aria-valuenow")).toBe("120");
    expect(chip.querySelector(".bpm-value")?.textContent).toBe("120");
  });

  it("click opens an inline editor; Enter commits the clamped value", async () => {
    const { chip, onCommit } = setup(120);
    pointer(chip, "pointerDown", 100);
    pointer(chip, "pointerUp", 100);
    await flush();

    const input = chip.querySelector("input.bpm-input") as HTMLInputElement;
    expect(input).toBeTruthy();
    expect(input.value).toBe("120");

    fireEvent.input(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onCommit).toHaveBeenCalledWith(BPM_MAX);
    expect(chip.querySelector("input.bpm-input")).toBeNull();
  });

  it("Escape cancels without committing", async () => {
    const { chip, onCommit } = setup(120);
    pointer(chip, "pointerDown", 100);
    pointer(chip, "pointerUp", 100);
    await flush();
    const input = chip.querySelector("input.bpm-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "90" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(onCommit).not.toHaveBeenCalled();
    expect(chip.querySelector("input.bpm-input")).toBeNull();
  });

  it("ignores non-numeric input on Enter", async () => {
    const { chip, onCommit } = setup(120);
    pointer(chip, "pointerDown", 100);
    pointer(chip, "pointerUp", 100);
    await flush();
    const input = chip.querySelector("input.bpm-input") as HTMLInputElement;
    fireEvent.input(input, { target: { value: "fast" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("returns focus to the previously focused element after a keyboard commit", async () => {
    const editorStandIn = document.createElement("textarea");
    document.body.appendChild(editorStandIn);
    editorStandIn.focus();
    try {
      const { chip } = setup(120);
      pointer(chip, "pointerDown", 100);
      pointer(chip, "pointerUp", 100);
      await flush();
      const input = chip.querySelector("input.bpm-input") as HTMLInputElement;
      fireEvent.keyDown(input, { key: "Escape" });
      expect(document.activeElement).toBe(editorStandIn);
    } finally {
      editorStandIn.remove();
    }
  });

  it("vertical drag scrubs and commits once on release without opening the editor", () => {
    const { chip, onCommit } = setup(120);
    pointer(chip, "pointerDown", 100);
    pointer(chip, "pointerMove", 60); // 40px up = +10 BPM
    expect(chip.querySelector(".bpm-value")?.textContent).toBe("130");
    expect(onCommit).not.toHaveBeenCalled();
    pointer(chip, "pointerUp", 60);
    expect(onCommit).toHaveBeenCalledOnce();
    expect(onCommit).toHaveBeenCalledWith(130);
    expect(chip.querySelector("input.bpm-input")).toBeNull();
  });

  it("does not take focus on pointer down", () => {
    const { chip } = setup(120);
    const down = pointer(chip, "pointerDown", 0);
    expect(down.defaultPrevented).toBe(true);
  });

  it("wheel and arrow keys step and commit after settling", () => {
    vi.useFakeTimers();
    const { chip, onCommit } = setup(120);

    fireEvent.wheel(chip, { deltaY: -100 });
    fireEvent.wheel(chip, { deltaY: -100 });
    expect(chip.querySelector(".bpm-value")?.textContent).toBe("122");
    expect(onCommit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(400);
    expect(onCommit).toHaveBeenCalledWith(122);

    onCommit.mockClear();
    fireEvent.keyDown(chip, { key: "ArrowDown", shiftKey: true });
    vi.advanceTimersByTime(400);
    expect(onCommit).toHaveBeenCalledWith(110);
  });
});
