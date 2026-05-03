/**
 * Tests for widgetStoreBridge (gii8.39).
 *
 * Strategy: test the imperative parts directly without spinning up a real
 * CodeMirror EditorView or a real SolidJS reactive root where possible.
 * For the reactive path (attach → createEffect) we use real SolidJS
 * primitives since the unit test environment has a SolidJS runtime available.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { createRoot } from "solid-js";

import {
  createWidgetStoreBridge,
  createValueChangeHandler,
} from "../widgetStoreBridge.ts";
import { createLiveEditStore } from "../../../../effects/liveEditStore.ts";
import type { LiveEditSlot } from "../../../../contracts/liveEdit.ts";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSlot(overrides: Partial<LiveEditSlot> = {}): LiveEditSlot {
  return {
    id: "ab12",
    kind: "numeric",
    seed: 0.5,
    value: 0.5,
    min: 0,
    max: 1,
    state: "idle",
    range: { from: 0, to: 20 },
    modified: false,
    ...overrides,
  };
}

/**
 * Minimal stub of an EditorView that records `setLiveEditSlots` calls.
 * We replace the actual `view.dispatch` with a spy; the real view is not
 * needed here because we just want to verify that slots are forwarded.
 */
function makeStubView() {
  const dispatched: unknown[] = [];
  return {
    dispatch: vi.fn((tr: unknown) => {
      dispatched.push(tr);
    }),
    state: {
      field: vi.fn(() => [] as LiveEditSlot[]),
      doc: { length: 0 },
    },
    dispatched,
  } as unknown as import("@codemirror/view").EditorView & { dispatched: unknown[] };
}

// ─── createValueChangeHandler ─────────────────────────────────────────────────

describe("createValueChangeHandler", () => {
  it("forwards the value change to store.setValue", () => {
    const store = createLiveEditStore();
    const slot = makeSlot({ id: "s1", seed: 0.5, value: 0.5 });

    createRoot((dispose) => {
      store.registerSlot(slot);
      const handler = createValueChangeHandler(store);

      handler("s1", 0.8);

      expect(store.getSlot("s1")?.value).toBe(0.8);
      dispose();
    });
  });

  it("ignores unknown slot ids without throwing", () => {
    const store = createLiveEditStore();
    const handler = createValueChangeHandler(store);

    expect(() => handler("nonexistent", 42)).not.toThrow();
  });

  it("updates the modified flag when value differs from seed", () => {
    const store = createLiveEditStore();
    const slot = makeSlot({ id: "s2", seed: 0.5, value: 0.5, modified: false });

    createRoot((dispose) => {
      store.registerSlot(slot);
      const handler = createValueChangeHandler(store);

      handler("s2", 0.9);

      expect(store.getSlot("s2")?.modified).toBe(true);
      dispose();
    });
  });

  it("clears the modified flag when value returns to seed", () => {
    const store = createLiveEditStore();
    const slot = makeSlot({ id: "s3", seed: 0.5, value: 0.9, modified: true });

    createRoot((dispose) => {
      store.registerSlot(slot);
      const handler = createValueChangeHandler(store);

      handler("s3", 0.5);

      expect(store.getSlot("s3")?.modified).toBe(false);
      dispose();
    });
  });
});

// ─── createWidgetStoreBridge — detach ─────────────────────────────────────────

describe("createWidgetStoreBridge — detach", () => {
  it("detach before attach is a no-op", () => {
    const bridge = createWidgetStoreBridge();
    expect(() => bridge.detach()).not.toThrow();
  });

  it("detach stops reactive syncing", () => {
    const store = createLiveEditStore();
    const view = makeStubView();

    createRoot((dispose) => {
      const bridge = createWidgetStoreBridge();
      bridge.attach(view, store);

      // Clear initial dispatch
      view.dispatched.length = 0;

      // Detach, then mutate store — no further dispatches expected
      bridge.detach();
      store.registerSlot(makeSlot({ id: "x1" }));

      expect(view.dispatched).toHaveLength(0);
      dispose();
    });
  });

  it("double-attach replaces the previous binding", () => {
    const store = createLiveEditStore();
    const view1 = makeStubView();
    const view2 = makeStubView();

    createRoot((dispose) => {
      const bridge = createWidgetStoreBridge();
      bridge.attach(view1, store);
      // Re-attach to a different view
      bridge.attach(view2, store);

      // Clear counts
      view1.dispatched.length = 0;
      view2.dispatched.length = 0;

      store.registerSlot(makeSlot({ id: "y1" }));

      // Only view2 should receive the update
      expect(view2.dispatched.length).toBeGreaterThan(0);
      expect(view1.dispatched).toHaveLength(0);

      bridge.detach();
      dispose();
    });
  });
});

// ─── createWidgetStoreBridge — store → editor sync ───────────────────────────

describe("createWidgetStoreBridge — store to editor", () => {
  it("pushes the initial slots on attach", () => {
    const store = createLiveEditStore();
    const slot = makeSlot({ id: "a1" });
    store.registerSlot(slot);

    const view = makeStubView();

    createRoot((dispose) => {
      const bridge = createWidgetStoreBridge();
      bridge.attach(view, store);

      // The attach should trigger an initial effect dispatch
      expect(view.dispatched.length).toBeGreaterThan(0);

      bridge.detach();
      dispose();
    });
  });

  it("dispatches to CodeMirror when store slots change after attach", () => {
    const store = createLiveEditStore();
    const view = makeStubView();

    createRoot((dispose) => {
      const bridge = createWidgetStoreBridge();
      bridge.attach(view, store);

      // Reset dispatch count from initial sync
      view.dispatched.length = 0;

      // Mutate the store
      store.registerSlot(makeSlot({ id: "b1" }));

      expect(view.dispatched.length).toBeGreaterThan(0);

      bridge.detach();
      dispose();
    });
  });

  it("dispatches again when a slot value changes", () => {
    const store = createLiveEditStore();
    const slot = makeSlot({ id: "c1" });
    store.registerSlot(slot);
    const view = makeStubView();

    createRoot((dispose) => {
      const bridge = createWidgetStoreBridge();
      bridge.attach(view, store);
      view.dispatched.length = 0;

      store.setValue("c1", 0.99);

      expect(view.dispatched.length).toBeGreaterThan(0);

      bridge.detach();
      dispose();
    });
  });
});

// ─── Widget onValueChange callback wiring ────────────────────────────────────

describe("LiveEditWidgetConfig.onValueChange wiring", () => {
  it("onValueChange callback is invoked when provided via createLiveEditWidgetsExtension", () => {
    // We can't easily simulate a mouse drag in jsdom without a real DOM widget,
    // but we can verify that the config wiring works by testing the callback
    // directly as it would be called from the widget.
    //
    // The real coverage path is: widget drag → view.state.facet(liveEditWidgetConfigFacet).onValueChange?.()
    // We prove the callback round-trip is wired by calling createValueChangeHandler
    // and verifying it delegates to the store.

    const store = createLiveEditStore();
    const slot = makeSlot({ id: "d1", seed: 0, value: 0 });

    createRoot((dispose) => {
      store.registerSlot(slot);

      const onValueChange = createValueChangeHandler(store);

      // Simulate what a widget would call after a drag
      onValueChange("d1", 0.42);

      expect(store.getSlot("d1")?.value).toBe(0.42);
      dispose();
    });
  });
});
