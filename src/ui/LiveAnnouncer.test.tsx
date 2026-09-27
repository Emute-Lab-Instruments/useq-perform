import { render } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  codeEvaluated,
  connectionChanged,
} from "../contracts/runtimeChannels";
import { addConsoleMessage } from "../utils/consoleStore";
import {
  LiveAnnouncer,
  errorAnnouncement,
  announce,
  resetLiveAnnouncerForTests,
} from "./LiveAnnouncer";

function region(container: HTMLElement, politeness: "polite" | "assertive") {
  return container.querySelector(`[aria-live="${politeness}"]`) as HTMLElement;
}

// Connection payloads need the full RuntimeSessionSnapshot shape.
function connectionDetail(
  connectionMode: "hardware" | "browser" | "none",
  connected = true,
) {
  return {
    hasHardwareConnection: connectionMode === "hardware",
    noModuleMode: connectionMode === "none",
    wasmEnabled: connectionMode === "browser",
    connectionMode,
    transportMode: "none" as const,
    connected,
    protocolMode: "json" as const,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  resetLiveAnnouncerForTests();
});

afterEach(() => {
  resetLiveAnnouncerForTests();
  vi.useRealTimers();
});

describe("announce()", () => {
  it("routes messages to the requested region", () => {
    const { container } = render(() => <LiveAnnouncer />);
    announce("Channels updated");
    expect(region(container, "polite").textContent).toBe("Channels updated");
    expect(region(container, "assertive").textContent).toBe("");

    announce("Evaluation failed", "assertive");
    expect(region(container, "assertive").textContent).toBe("Evaluation failed");
  });

  it("clears announced text so identical messages re-announce", () => {
    const { container } = render(() => <LiveAnnouncer />);
    announce("Evaluated");
    expect(region(container, "polite").textContent).toBe("Evaluated");

    vi.advanceTimersByTime(200);
    expect(region(container, "polite").textContent).toBe("");
  });

  it("collapses bursts into the latest message", () => {
    const { container } = render(() => <LiveAnnouncer />);
    announce("first");
    announce("second");
    announce("third");
    // Only the first message is announced immediately; the rest collapse.
    expect(region(container, "polite").textContent).toBe("first");

    vi.advanceTimersByTime(1000);
    expect(region(container, "polite").textContent).toBe("third");
  });

  it("allows at most one announcement per second per politeness level", () => {
    const { container } = render(() => <LiveAnnouncer />);
    announce("one");
    expect(region(container, "polite").textContent).toBe("one");

    // Still inside the 1s window: "two" is deferred, region keeps "one".
    vi.advanceTimersByTime(100);
    announce("two");
    expect(region(container, "polite").textContent).toBe("one");

    vi.advanceTimersByTime(900);
    expect(region(container, "polite").textContent).toBe("two");
  });

  it("ignores empty messages", () => {
    const { container } = render(() => <LiveAnnouncer />);
    announce("");
    expect(region(container, "polite").textContent).toBe("");
  });
});

describe("LiveAnnouncer wiring", () => {
  it("announces eval success from the codeEvaluated channel", () => {
    const { container } = render(() => <LiveAnnouncer />);
    codeEvaluated.publish({ code: "(a1 t)" });
    expect(region(container, "polite").textContent).toBe("Evaluated");
  });

  it("announces connection changes by runtime mode", () => {
    const { container } = render(() => <LiveAnnouncer />);

    connectionChanged.publish(connectionDetail("hardware"));
    expect(region(container, "polite").textContent).toBe(
      "Connected to uSEQ hardware",
    );

    vi.advanceTimersByTime(1000);
    connectionChanged.publish(connectionDetail("browser"));
    expect(region(container, "polite").textContent).toBe("Using virtual uSEQ");

    vi.advanceTimersByTime(1000);
    connectionChanged.publish(connectionDetail("none", false));
    expect(region(container, "polite").textContent).toBe("No runtime");
  });

  it("announces console errors with their text (assertive)", () => {
    const { container } = render(() => <LiveAnnouncer />);
    addConsoleMessage("undefined variable: `foo`", "error");
    expect(region(container, "assertive").textContent).toBe(
      "Error: undefined variable: foo",
    );
  });

  it("caps long error announcements", () => {
    const long = "x".repeat(300);
    const text = errorAnnouncement(long);
    expect(text.length).toBeLessThanOrEqual("Error: ".length + 120);
    expect(text.endsWith("…")).toBe(true);
  });

  it("does not announce non-error console messages", () => {
    const { container } = render(() => <LiveAnnouncer />);
    addConsoleMessage("hello from lisp", "log");
    expect(region(container, "assertive").textContent).toBe("");
    expect(region(container, "polite").textContent).toBe("");
  });
});
