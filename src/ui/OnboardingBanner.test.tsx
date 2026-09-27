import { render, fireEvent } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Module mocks ───────────────────────────────────────────────

const h = vi.hoisted(() => {
  const listeners = new Set<
    (state: { session: { connectionMode: string } }) => void
  >();
  const holder = {
    state: { session: { connectionMode: "none" } },
    listeners,
    toggleRuntimeConnection: vi.fn(),
    updateSettings: vi.fn(),
    load: vi.fn(() => false),
    save: vi.fn(),
    /** Simulate a runtime session mode transition. */
    publishMode(mode: string) {
      holder.state = { session: { connectionMode: mode } };
      for (const listener of listeners) listener(holder.state);
    },
  };
  return holder;
});

vi.mock("../runtime/runtimeService", () => ({
  getRuntimeServiceSnapshot: () => h.state,
  subscribeRuntimeService: (
    cb: (state: { session: { connectionMode: string } }) => void,
  ) => {
    h.listeners.add(cb);
    return () => {
      h.listeners.delete(cb);
    };
  },
  toggleRuntimeConnection: h.toggleRuntimeConnection,
  updateSettings: h.updateSettings,
}));

vi.mock("../lib/persistence", () => ({
  load: h.load,
  save: h.save,
  PERSISTENCE_KEYS: { onboardingDismissed: "useq:onboarding-dismissed" },
}));

import { OnboardingBanner } from "./OnboardingBanner";

// ── Helpers ────────────────────────────────────────────────────

function stubWasmSupported() {
  vi.stubGlobal("Worker", class {});
}

function renderBanner() {
  return render(() => <OnboardingBanner />);
}

// ── Tests ──────────────────────────────────────────────────────

describe("OnboardingBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.state = { session: { connectionMode: "none" } };
    h.load.mockReturnValue(false);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows both actions in none mode when the browser supports WASM", () => {
    stubWasmSupported();
    const { container } = renderBanner();

    expect(container.querySelector(".onboarding-banner")).not.toBeNull();
    expect(container.textContent).toContain("No runtime active.");
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (b) => b.textContent === "Connect uSEQ (USB)",
      ),
    ).toBe(true);
    expect(
      Array.from(container.querySelectorAll("button")).some(
        (b) => b.textContent === "Use virtual uSEQ (WASM)",
      ),
    ).toBe(true);
  });

  it("enables the virtual runtime through the settings mutation surface", () => {
    stubWasmSupported();
    const { container } = renderBanner();

    const wasmButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Use virtual uSEQ (WASM)",
    );
    fireEvent.click(wasmButton!);

    expect(h.updateSettings).toHaveBeenCalledTimes(1);
    expect(h.updateSettings).toHaveBeenCalledWith({
      wasm: { enabled: true },
    });
    expect(h.toggleRuntimeConnection).not.toHaveBeenCalled();
  });

  it("connect action requests the USB connection", () => {
    stubWasmSupported();
    const { container } = renderBanner();

    const connectButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Connect uSEQ (USB)",
    );
    fireEvent.click(connectButton!);

    expect(h.toggleRuntimeConnection).toHaveBeenCalledTimes(1);
  });

  it("dismiss hides the banner for the session without persisting", () => {
    stubWasmSupported();
    const { container } = renderBanner();

    const dismissButton = container.querySelector(
      ".onboarding-banner__dismiss:not(.onboarding-banner__dismiss--permanent)",
    )!;
    fireEvent.click(dismissButton);

    expect(container.querySelector(".onboarding-banner")).toBeNull();
    expect(h.save).not.toHaveBeenCalled();
  });

  it("'Don't show again' persists the dismissal via the persistence service", () => {
    stubWasmSupported();
    const { container } = renderBanner();

    const permanentButton = container.querySelector(
      ".onboarding-banner__dismiss--permanent",
    )!;
    fireEvent.click(permanentButton);

    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save).toHaveBeenCalledWith("useq:onboarding-dismissed", true);
    expect(container.querySelector(".onboarding-banner")).toBeNull();
  });

  it("stays hidden when the banner was previously dismissed permanently", () => {
    h.load.mockReturnValue(true);
    const { container } = renderBanner();

    expect(container.querySelector(".onboarding-banner")).toBeNull();
  });

  it("hides itself once a runtime becomes available", () => {
    stubWasmSupported();
    const { container } = renderBanner();
    expect(container.querySelector(".onboarding-banner")).not.toBeNull();

    h.publishMode("wasm");

    expect(container.querySelector(".onboarding-banner")).toBeNull();
  });

  it("explains when WASM is unsupported instead of offering the action", () => {
    // jsdom has no Worker: browserSupportsWasmRuntime() is false by default.
    const { container } = renderBanner();

    expect(container.querySelector(".onboarding-banner__wasm")).toBeNull();
    const note = container.querySelector(".onboarding-banner__wasm-note");
    expect(note).not.toBeNull();
    expect(note?.getAttribute("title")).toContain("WebAssembly");
    expect(container.textContent).toContain("WASM unavailable in this browser");
  });

  it("does not steal focus on mount (overlays.md §1.6)", () => {
    stubWasmSupported();
    renderBanner();

    expect(document.activeElement).toBe(document.body);
  });
});
