import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  pushOverlay,
  _resetForTesting,
  _stackDepth,
} from "./overlayManager";

beforeEach(() => {
  _resetForTesting();
});

// ---------------------------------------------------------------------------
// Escape dispatching — top-of-stack only
// ---------------------------------------------------------------------------
describe("overlayManager — Escape handling", () => {
  it("calls onEscape for a single registered overlay", () => {
    const onEscape = vi.fn();
    const pop = pushOverlay("a", onEscape);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onEscape).toHaveBeenCalledOnce();
    pop();
  });

  it("calls onEscape for the topmost overlay only (LIFO order)", () => {
    const onEscapeA = vi.fn();
    const onEscapeB = vi.fn();

    const popA = pushOverlay("a", onEscapeA);
    const popB = pushOverlay("b", onEscapeB);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onEscapeB).toHaveBeenCalledOnce();
    expect(onEscapeA).not.toHaveBeenCalled();

    popB();
    popA();
  });

  it("dispatches to next overlay after top is popped", () => {
    const onEscapeA = vi.fn();
    const onEscapeB = vi.fn();

    const popA = pushOverlay("a", onEscapeA);
    const popB = pushOverlay("b", onEscapeB);

    // Close the top overlay
    popB();

    // Now A is topmost
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onEscapeA).toHaveBeenCalledOnce();
    expect(onEscapeB).not.toHaveBeenCalled();

    popA();
  });

  it("does not fire anything when stack is empty", () => {
    const onEscape = vi.fn();
    const pop = pushOverlay("a", onEscape);
    pop(); // immediately pop

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));

    expect(onEscape).not.toHaveBeenCalled();
  });

  it("ignores non-Escape keydown events", () => {
    const onEscape = vi.fn();
    const pop = pushOverlay("a", onEscape);

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));

    expect(onEscape).not.toHaveBeenCalled();
    pop();
  });

  it("three stacked overlays close in LIFO order", () => {
    const calls: string[] = [];
    const popA = pushOverlay("a", () => calls.push("a"));
    const popB = pushOverlay("b", () => calls.push("b"));
    const popC = pushOverlay("c", () => calls.push("c"));

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    popC(); // simulate component reacting to Escape
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    popB();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    popA();

    expect(calls).toEqual(["c", "b", "a"]);
  });
});

// ---------------------------------------------------------------------------
// Scroll lock reference counting
// ---------------------------------------------------------------------------
describe("overlayManager — scroll lock", () => {
  it("sets body overflow to hidden when first overlay is pushed", () => {
    document.body.style.overflow = "";
    const pop = pushOverlay("a", () => {});

    expect(document.body.style.overflow).toBe("hidden");
    pop();
  });

  it("keeps body overflow hidden while any overlay is open", () => {
    const popA = pushOverlay("a", () => {});
    const popB = pushOverlay("b", () => {});

    popA(); // A removed — B still open

    expect(document.body.style.overflow).toBe("hidden");
    popB();
  });

  it("restores body overflow when last overlay is popped", () => {
    document.body.style.overflow = "";
    const popA = pushOverlay("a", () => {});
    const popB = pushOverlay("b", () => {});

    popA();
    expect(document.body.style.overflow).toBe("hidden");

    popB();
    expect(document.body.style.overflow).toBe("");
  });

  it("restores the original overflow value, not always empty string", () => {
    document.body.style.overflow = "auto";
    const pop = pushOverlay("a", () => {});

    expect(document.body.style.overflow).toBe("hidden");

    pop();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("reference counts correctly with three overlays", () => {
    document.body.style.overflow = "";
    const popA = pushOverlay("a", () => {});
    const popB = pushOverlay("b", () => {});
    const popC = pushOverlay("c", () => {});

    // Overflow is hidden throughout
    expect(document.body.style.overflow).toBe("hidden");

    popB(); // pop middle — A and C still present
    expect(document.body.style.overflow).toBe("hidden");

    popA();
    expect(document.body.style.overflow).toBe("hidden");

    popC(); // last one
    expect(document.body.style.overflow).toBe("");
  });

  it("pop is idempotent — second call does not double-release lock", () => {
    document.body.style.overflow = "";
    const pop = pushOverlay("a", () => {});
    pop();
    pop(); // second call should be a no-op

    expect(document.body.style.overflow).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Stack depth tracking
// ---------------------------------------------------------------------------
describe("overlayManager — stack depth", () => {
  it("reports correct depth as overlays are pushed and popped", () => {
    expect(_stackDepth()).toBe(0);

    const popA = pushOverlay("a", () => {});
    expect(_stackDepth()).toBe(1);

    const popB = pushOverlay("b", () => {});
    expect(_stackDepth()).toBe(2);

    popA();
    expect(_stackDepth()).toBe(1);

    popB();
    expect(_stackDepth()).toBe(0);
  });
});
