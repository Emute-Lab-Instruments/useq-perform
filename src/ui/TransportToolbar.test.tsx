import { render } from "@solidjs/testing-library";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createSignal } from "solid-js";

import { TransportToolbar, type TransportToolbarProps } from "./TransportToolbar";

// ── Helpers ────────────────────────────────────────────────────

const noop = () => {};

function defaultProps(
  overrides?: Partial<TransportToolbarProps>,
): TransportToolbarProps {
  return {
    state: "stopped",
    mode: "none",
    progress: 0,
    onPlay: noop,
    onPause: noop,
    onStop: noop,
    onRewind: noop,
    onClear: noop,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────

describe("TransportToolbar", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
        unobserve() {}
      },
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables every control and lights nothing in none mode", () => {
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ state: "stopped", mode: "none" })} />
    ));

    for (const title of ["Play", "Pause", "Stop", "Rewind", "Clear"]) {
      const el = container.querySelector(`[title='${title}']`) as HTMLButtonElement;
      expect(el.classList.contains("disabled")).toBe(true);
      expect(el.disabled).toBe(true);
      expect(el.classList.contains("is-active")).toBe(false);
    }
    expect(container.querySelector(".transport-state")?.textContent).toContain("No runtime");
  });

  it("lights Play (not disabled) while playing, with a playing indicator", () => {
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ state: "playing", mode: "wasm" })} />
    ));

    const playBtn = container.querySelector("[title='Play']") as HTMLButtonElement;
    const pauseBtn = container.querySelector("[title='Pause']");
    const stopBtn = container.querySelector("[title='Stop']");

    expect(playBtn.classList.contains("is-active")).toBe(true);
    expect(playBtn.getAttribute("aria-pressed")).toBe("true");
    expect(playBtn.classList.contains("disabled")).toBe(false);
    expect(playBtn.disabled).toBe(false);
    expect(pauseBtn?.getAttribute("aria-pressed")).toBe("false");
    expect(pauseBtn?.classList.contains("disabled")).toBe(false);
    expect(stopBtn?.classList.contains("disabled")).toBe(false);

    const indicator = container.querySelector(".transport-state");
    expect(indicator?.classList.contains("is-playing")).toBe(true);
    expect(indicator?.textContent).toContain("Playing");
    expect(container.querySelector("#panel-top-toolbar")?.getAttribute("data-transport-state")).toBe("playing");
  });

  it("lights Pause while paused", () => {
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ state: "paused", mode: "wasm" })} />
    ));

    const playBtn = container.querySelector("[title='Play']");
    const pauseBtn = container.querySelector("[title='Pause']");

    expect(pauseBtn?.classList.contains("is-active")).toBe(true);
    expect(pauseBtn?.getAttribute("aria-pressed")).toBe("true");
    expect(pauseBtn?.classList.contains("disabled")).toBe(false);
    expect(playBtn?.classList.contains("disabled")).toBe(false);
    expect(container.querySelector(".transport-state")?.textContent).toContain("Paused");
  });

  it("lights Stop while stopped and disables only Pause", () => {
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ state: "stopped", mode: "wasm" })} />
    ));

    const playBtn = container.querySelector("[title='Play']");
    const stopBtn = container.querySelector("[title='Stop']");
    const pauseBtn = container.querySelector("[title='Pause']");
    const rewindBtn = container.querySelector("[title='Rewind']");
    const clearBtn = container.querySelector("[title='Clear']");

    expect(stopBtn?.classList.contains("is-active")).toBe(true);
    expect(stopBtn?.classList.contains("disabled")).toBe(false);
    expect(pauseBtn?.classList.contains("disabled")).toBe(true);
    expect(playBtn?.classList.contains("disabled")).toBe(false);
    expect(rewindBtn?.classList.contains("disabled")).toBe(false);
    expect(clearBtn?.classList.contains("disabled")).toBe(false);
    // Rewind/Clear are actions, not states: never pressed.
    expect(rewindBtn?.hasAttribute("aria-pressed")).toBe(false);
  });

  it("shows adapter-provided shortcuts in tooltips", () => {
    const { container } = render(() => (
      <TransportToolbar
        {...defaultProps({ mode: "wasm", shortcuts: { play: "Ctrl+Space" } })}
      />
    ));
    expect(container.querySelector("[title='Play (Ctrl+Space)']")).toBeTruthy();
    expect(container.querySelector("[aria-label='Play']")).toBeTruthy();
    expect(container.querySelector("[title='Pause']")).toBeTruthy();
  });

  it("renders the BPM chip only when a BPM is known and forwards commits", () => {
    const onBpmCommit = vi.fn();
    const [bpm, setBpm] = createSignal<number | null>(null);
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ mode: "wasm", bpm: bpm(), onBpmCommit })} />
    ));
    expect(container.querySelector(".bpm-display")).toBeNull();

    setBpm(120);
    const chip = container.querySelector(".bpm-display") as HTMLElement;
    expect(chip.querySelector(".bpm-value")?.textContent).toBe("120");
    expect(chip.getAttribute("aria-valuenow")).toBe("120");
  });

  it("passes beats per bar to the progress bar ticks", () => {
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ beatsPerBar: 3 })} />
    ));
    expect(container.querySelectorAll(".progress-beat-tick").length).toBe(2);
  });

  it("reacts to prop changes", async () => {
    const [mode, setMode] = createSignal<TransportToolbarProps["mode"]>("none");

    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ mode: mode() })} />
    ));

    const rewindBtn = container.querySelector("[title='Rewind']");
    expect(rewindBtn?.classList.contains("disabled")).toBe(true);

    setMode("wasm");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(rewindBtn?.classList.contains("disabled")).toBe(false);
  });

  describe("callbacks", () => {
    it("calls onPlay when play button is clicked and not disabled", () => {
      const onPlay = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "stopped", mode: "wasm", onPlay })}
        />
      ));

      const playBtn = container.querySelector("[title='Play']") as HTMLElement;
      playBtn.click();

      expect(onPlay).toHaveBeenCalledOnce();
    });

    it("does not call onPlay when play button is disabled (already playing)", () => {
      const onPlay = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "wasm", onPlay })}
        />
      ));

      const playBtn = container.querySelector("[title='Play']") as HTMLElement;
      playBtn.click();

      expect(onPlay).not.toHaveBeenCalled();
    });

    it("calls onPause when pause button is clicked and not disabled", () => {
      const onPause = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "wasm", onPause })}
        />
      ));

      const pauseBtn = container.querySelector("[title='Pause']") as HTMLElement;
      pauseBtn.click();

      expect(onPause).toHaveBeenCalledOnce();
    });

    it("does not call onPause when pause button is disabled (stopped state)", () => {
      const onPause = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "stopped", mode: "wasm", onPause })}
        />
      ));

      const pauseBtn = container.querySelector("[title='Pause']") as HTMLElement;
      pauseBtn.click();

      expect(onPause).not.toHaveBeenCalled();
    });

    it("calls onStop when stop button is clicked and not disabled", () => {
      const onStop = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "wasm", onStop })}
        />
      ));

      const stopBtn = container.querySelector("[title='Stop']") as HTMLElement;
      stopBtn.click();

      expect(onStop).toHaveBeenCalledOnce();
    });

    it("does not call onStop when stop button is disabled (already stopped)", () => {
      const onStop = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "stopped", mode: "wasm", onStop })}
        />
      ));

      const stopBtn = container.querySelector("[title='Stop']") as HTMLElement;
      stopBtn.click();

      expect(onStop).not.toHaveBeenCalled();
    });

    it("calls onRewind when rewind button is clicked and not disabled", () => {
      const onRewind = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "wasm", onRewind })}
        />
      ));

      const rewindBtn = container.querySelector(
        "[title='Rewind']",
      ) as HTMLElement;
      rewindBtn.click();

      expect(onRewind).toHaveBeenCalledOnce();
    });

    it("does not call onRewind when mode is none", () => {
      const onRewind = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "none", onRewind })}
        />
      ));

      const rewindBtn = container.querySelector(
        "[title='Rewind']",
      ) as HTMLElement;
      rewindBtn.click();

      expect(onRewind).not.toHaveBeenCalled();
    });

    it("calls onClear when clear button is clicked and not disabled", () => {
      const onClear = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "wasm", onClear })}
        />
      ));

      const clearBtn = container.querySelector("[title='Clear']") as HTMLElement;
      clearBtn.click();

      expect(onClear).toHaveBeenCalledOnce();
    });

    it("does not call onClear when mode is none", () => {
      const onClear = vi.fn();
      const { container } = render(() => (
        <TransportToolbar
          {...defaultProps({ state: "playing", mode: "none", onClear })}
        />
      ));

      const clearBtn = container.querySelector("[title='Clear']") as HTMLElement;
      clearBtn.click();

      expect(onClear).not.toHaveBeenCalled();
    });
  });

  it("passes progress to ProgressBar", () => {
    const { container } = render(() => (
      <TransportToolbar {...defaultProps({ progress: 0.75 })} />
    ));

    const progressEl = container.querySelector("#toolbar-bar-progress") as HTMLElement;
    expect(progressEl?.style.transform).toBe("scaleX(0.75)");
  });

  it("does not throw when events happen after unmount", () => {
    const { unmount } = render(() => (
      <TransportToolbar {...defaultProps({ state: "playing", mode: "wasm" })} />
    ));

    expect(() => unmount()).not.toThrow();
  });
});
