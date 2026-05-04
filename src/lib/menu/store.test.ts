// src/lib/menu/store.test.ts
//
// Smoke tests for the Solid reactive store wrapping the pure menu reducer.
// Confirms:
//   - the store starts at INITIAL_STATE
//   - `dispatchMenuInput({kind:'open', ...})` transitions to an open state
//   - `dispatchMenuInput({kind:'cancel'})` closes the menu
//   - subscribers via `createEffect` observe updates
//
// Manifest + ApplyTarget fixtures are built inline — the store layer should
// not depend on `manifest.json` or any concrete cursor shape.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createEffect, createRoot } from "solid-js";

import type {
  ApplyTarget,
  CategoryId,
  ItemId,
  Manifest,
  TabId,
} from "./types";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** A minimal valid manifest — one tab, one category, one symbol item. */
function makeManifest(): Manifest {
  return {
    version: 1,
    tabs: [
      {
        id: "symbols" as TabId,
        label: "Symbols",
        categories: [
          {
            id: "common" as CategoryId,
            label: "Common",
            items: [
              {
                kind: "symbol",
                id: "sym-x" as ItemId,
                label: "x",
                text: "x",
              },
            ],
          },
        ],
      },
    ],
  };
}

/** ApplyTarget is opaque outside structural-editing; cast a stub here. */
function makeTarget(): ApplyTarget {
  return { __brand: "ApplyTarget" } as ApplyTarget;
}

/**
 * Reload the store module fresh on each test so the module-scope signal
 * starts at INITIAL_STATE. Mirrors the pattern in
 * `src/utils/visualisationStore.test.ts`.
 */
async function loadStore() {
  vi.resetModules();
  return await import("./store");
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("menu/store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("initially equals INITIAL_STATE (phase=closed)", async () => {
    const { menuState, isMenuOpen } = await loadStore();
    const { INITIAL_STATE } = await import("./state");
    expect(menuState()).toBe(INITIAL_STATE);
    expect(menuState().phase).toBe("closed");
    expect(isMenuOpen()).toBe(false);
  });

  it("transitions to open state on dispatch of an 'open' input", async () => {
    const { menuState, isMenuOpen, dispatchMenuInput } = await loadStore();

    const target = makeTarget();
    const manifest = makeManifest();
    dispatchMenuInput({ kind: "open", target, manifest });

    const s = menuState();
    expect(s.phase).toBe("open");
    expect(isMenuOpen()).toBe(true);
    if (s.phase === "open") {
      expect(s.target).toBe(target);
      expect(s.manifest).toBe(manifest);
      expect(s.leftHover).toBe(null);
      expect(s.rightHover).toBe(null);
    }
  });

  it("closes the menu on dispatch of a 'cancel' input", async () => {
    const { menuState, isMenuOpen, dispatchMenuInput } = await loadStore();

    dispatchMenuInput({
      kind: "open",
      target: makeTarget(),
      manifest: makeManifest(),
    });
    expect(isMenuOpen()).toBe(true);

    dispatchMenuInput({ kind: "cancel" });
    expect(menuState().phase).toBe("closed");
    expect(isMenuOpen()).toBe(false);
  });

  it("notifies Solid subscribers via createEffect on every transition", async () => {
    const { menuState, dispatchMenuInput } = await loadStore();

    const phases: string[] = [];
    const dispose = createRoot((dispose) => {
      createEffect(() => {
        phases.push(menuState().phase);
      });
      return dispose;
    });

    // The effect runs once synchronously on creation with the initial state,
    // then again after each mutation that yields a new state reference.
    dispatchMenuInput({
      kind: "open",
      target: makeTarget(),
      manifest: makeManifest(),
    });
    dispatchMenuInput({ kind: "cancel" });

    // Solid effects are batched and may run on a microtask boundary; await
    // a microtask flush before asserting.
    await Promise.resolve();

    expect(phases[0]).toBe("closed");
    expect(phases).toContain("open");
    expect(phases[phases.length - 1]).toBe("closed");

    dispose();
  });
});
