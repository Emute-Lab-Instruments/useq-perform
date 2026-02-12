import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dynamic-import an island module with a fresh module graph so that
 * top-level side-effects (window assignments, render calls) re-execute.
 */
async function freshImport(modulePath: string) {
  vi.resetModules();
  return import(modulePath);
}

// ---------------------------------------------------------------------------
// 1. window.__virtualGamepad  (src-solid/ui/VirtualGamepad.tsx)
// ---------------------------------------------------------------------------

describe("window.__virtualGamepad bridge", () => {
  beforeEach(async () => {
    delete window.__virtualGamepad;
    await freshImport("../ui/VirtualGamepad");
  });

  it("exposes __virtualGamepad on window after import", () => {
    expect(window.__virtualGamepad).toBeDefined();
    expect(typeof window.__virtualGamepad!.get).toBe("function");
    expect(typeof window.__virtualGamepad!.set).toBe("function");
    expect(typeof window.__virtualGamepad!.reset).toBe("function");
  });

  it("get() returns default state with 17 buttons and 4 axes", () => {
    const state = window.__virtualGamepad!.get();
    expect(state.buttons).toHaveLength(17);
    expect(state.axes).toEqual([0, 0, 0, 0]);
    // All buttons unpressed by default
    state.buttons.forEach((btn) => {
      expect(btn.pressed).toBe(false);
      expect(btn.value).toBe(0);
    });
  });

  it("set() merges partial state and updates timestamp", () => {
    const before = window.__virtualGamepad!.get();
    window.__virtualGamepad!.set({ axes: [1, -1, 0.5, -0.5] });
    const after = window.__virtualGamepad!.get();

    expect(after.axes).toEqual([1, -1, 0.5, -0.5]);
    // Buttons should remain untouched
    expect(after.buttons).toHaveLength(17);
    // Timestamp should have advanced
    expect(after.timestamp).toBeGreaterThanOrEqual(before.timestamp);
  });

  it("set() can update buttons", () => {
    const newButtons = Array.from({ length: 17 }, (_, i) => ({
      pressed: i === 0,
      value: i === 0 ? 1 : 0,
    }));
    window.__virtualGamepad!.set({ buttons: newButtons });

    const state = window.__virtualGamepad!.get();
    expect(state.buttons[0].pressed).toBe(true);
    expect(state.buttons[0].value).toBe(1);
    expect(state.buttons[1].pressed).toBe(false);
  });

  it("reset() restores default state", () => {
    // Mutate state first
    window.__virtualGamepad!.set({ axes: [1, 1, 1, 1] });
    expect(window.__virtualGamepad!.get().axes).toEqual([1, 1, 1, 1]);

    // Reset
    window.__virtualGamepad!.reset();
    const state = window.__virtualGamepad!.get();
    expect(state.axes).toEqual([0, 0, 0, 0]);
    state.buttons.forEach((btn) => {
      expect(btn.pressed).toBe(false);
      expect(btn.value).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. window.__solidModal  (src-solid/islands/modal.tsx)
// ---------------------------------------------------------------------------

describe("window.__solidModal bridge", () => {
  beforeEach(async () => {
    // Clean up any prior root element
    document.getElementById("solid-modal-root")?.remove();
    delete window.__solidModal;
    await freshImport("./modal");
  });

  it("exposes __solidModal on window after import", () => {
    expect(window.__solidModal).toBeDefined();
    expect(typeof window.__solidModal!.showModal).toBe("function");
    expect(typeof window.__solidModal!.closeModal).toBe("function");
  });

  it("creates a solid-modal-root element in the DOM", () => {
    const root = document.getElementById("solid-modal-root");
    expect(root).toBeTruthy();
    expect(root!.style.position).toBe("fixed");
  });

  it("showModal() does not throw", () => {
    expect(() => {
      window.__solidModal!.showModal("test-id", "Test Title", "<p>Hello</p>");
    }).not.toThrow();
  });

  it("closeModal() does not throw", () => {
    window.__solidModal!.showModal("test-id", "Test Title", "<p>Hello</p>");
    expect(() => {
      window.__solidModal!.closeModal("test-id");
    }).not.toThrow();
  });

  it("showModal renders content into the root, closeModal removes it", () => {
    const root = document.getElementById("solid-modal-root")!;

    window.__solidModal!.showModal("m1", "My Modal", "<p>Body text</p>");
    // The modal should render something into the root
    expect(root.innerHTML.length).toBeGreaterThan(0);

    window.__solidModal!.closeModal("m1");
    // After closing, the rendered content should be empty (Show is falsy)
    // The root element itself remains, but Show renders nothing
    // Give Solid a tick to flush
    expect(root.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. window.__pickerMenu  (src-solid/islands/picker-menu.tsx)
// ---------------------------------------------------------------------------

describe("window.__pickerMenu bridge", () => {
  beforeEach(async () => {
    document.getElementById("picker-menu-root")?.remove();
    delete window.__pickerMenu;
    await freshImport("./picker-menu");
  });

  it("exposes __pickerMenu on window after import", () => {
    expect(window.__pickerMenu).toBeDefined();
    expect(typeof window.__pickerMenu!.showPickerMenu).toBe("function");
    expect(typeof window.__pickerMenu!.showNumberPickerMenu).toBe("function");
    expect(typeof window.__pickerMenu!.showHierarchicalGridPicker).toBe("function");
    expect(typeof window.__pickerMenu!.close).toBe("function");
  });

  it("creates a picker-menu-root element in the DOM", () => {
    const root = document.getElementById("picker-menu-root");
    expect(root).toBeTruthy();
    expect(root!.style.zIndex).toBe("1000");
  });

  it("showPickerMenu() returns a close function", () => {
    const closeFn = window.__pickerMenu!.showPickerMenu({
      items: [{ label: "Item A" }, { label: "Item B" }],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
  });

  it("showPickerMenu() with empty items returns a no-op close function", () => {
    const closeFn = window.__pickerMenu!.showPickerMenu({
      items: [],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
    // Calling it should not throw
    expect(() => closeFn()).not.toThrow();
  });

  it("showNumberPickerMenu() returns a close function", () => {
    const closeFn = window.__pickerMenu!.showNumberPickerMenu({
      onSelect: vi.fn(),
      title: "Pick a number",
      min: 0,
      max: 100,
    });
    expect(typeof closeFn).toBe("function");
  });

  it("showHierarchicalGridPicker() returns a close function", () => {
    const closeFn = window.__pickerMenu!.showHierarchicalGridPicker({
      categories: [
        {
          label: "Cat A",
          items: [{ label: "Entry 1", value: 1 }],
        },
      ],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
  });

  it("showHierarchicalGridPicker() with empty categories returns no-op", () => {
    const closeFn = window.__pickerMenu!.showHierarchicalGridPicker({
      categories: [],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
    expect(() => closeFn()).not.toThrow();
  });

  it("close() does not throw when no menu is open", () => {
    expect(() => window.__pickerMenu!.close()).not.toThrow();
  });

  it("close() works after opening a menu", () => {
    window.__pickerMenu!.showPickerMenu({
      items: [{ label: "X" }],
      onSelect: vi.fn(),
    });
    expect(() => window.__pickerMenu!.close()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. window.__doubleRadialMenu  (src-solid/islands/double-radial-menu.tsx)
// ---------------------------------------------------------------------------

describe("window.__doubleRadialMenu bridge", () => {
  beforeEach(async () => {
    document.getElementById("double-radial-menu-root")?.remove();
    // Restore body overflow in case a previous test locked it
    document.body.style.overflow = "";
    delete window.__doubleRadialMenu;
    await freshImport("./double-radial-menu");
  });

  it("exposes __doubleRadialMenu on window after import", () => {
    expect(window.__doubleRadialMenu).toBeDefined();
    expect(typeof window.__doubleRadialMenu!.open).toBe("function");
    expect(typeof window.__doubleRadialMenu!.close).toBe("function");
  });

  it("creates a double-radial-menu-root element in the DOM", () => {
    const root = document.getElementById("double-radial-menu-root");
    expect(root).toBeTruthy();
    expect(root!.style.zIndex).toBe("1100");
  });

  it("open() returns a close function", () => {
    const closeFn = window.__doubleRadialMenu!.open({
      categories: [
        {
          label: "Test",
          items: [{ label: "Item 1" }],
        },
      ],
    });
    expect(typeof closeFn).toBe("function");
  });

  it("open() locks body scroll", () => {
    document.body.style.overflow = "auto";
    window.__doubleRadialMenu!.open({
      categories: [{ label: "Cat", items: [{ label: "X" }] }],
    });
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("close() unlocks body scroll", () => {
    document.body.style.overflow = "auto";
    window.__doubleRadialMenu!.open({
      categories: [{ label: "Cat", items: [{ label: "X" }] }],
    });
    expect(document.body.style.overflow).toBe("hidden");

    window.__doubleRadialMenu!.close();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("returned close function also unlocks scroll", () => {
    document.body.style.overflow = "scroll";
    const closeFn = window.__doubleRadialMenu!.open({
      categories: [{ label: "Cat", items: [{ label: "X" }] }],
    });
    expect(document.body.style.overflow).toBe("hidden");

    closeFn();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("close() does not throw when menu is not open", () => {
    expect(() => window.__doubleRadialMenu!.close()).not.toThrow();
  });

  it("open() accepts optional callbacks without throwing", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    expect(() => {
      window.__doubleRadialMenu!.open({
        categories: [{ label: "C", items: [{ label: "I" }] }],
        onSelect,
        onCancel,
        title: "Pick something",
        menuSize: 400,
        innerRadiusRatio: 0.3,
        stickThreshold: 0.6,
      });
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 5. window.__snippetsPanel  (src-solid/islands/snippets-panel.tsx)
// ---------------------------------------------------------------------------

/**
 * The snippets-panel island transitively imports snippetStore which calls
 * localStorage.getItem / .setItem at module evaluation time.  jsdom exposes
 * a Storage prototype but individual environments can have broken stubs.
 * We install a minimal in-memory shim before each import to keep the module
 * evaluation happy.
 */
function installLocalStorageMock() {
  const store = new Map<string, string>();
  const mock = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, String(value));
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    get length() {
      return store.size;
    },
    key: (index: number) => {
      return [...store.keys()][index] ?? null;
    },
  } as Storage;
  Object.defineProperty(globalThis, "localStorage", {
    value: mock,
    writable: true,
    configurable: true,
  });
  return mock;
}

describe("window.__snippetsPanel bridge", () => {
  beforeEach(async () => {
    // Use fake timers to prevent background timer callbacks (e.g. from legacy
    // serialComms.mjs which references jQuery `$`) from firing and causing
    // uncaught ReferenceError during the test run.
    vi.useFakeTimers();

    // Remove any prior mount target
    document.getElementById("panel-snippets")?.remove();
    document.getElementById("test-snippets-mount")?.remove();
    delete window.__snippetsPanel;
    // Install a working localStorage before the island (and snippetStore) loads
    installLocalStorageMock();
    // The island auto-mounts if "panel-snippets" exists. We omit it by default
    // so it only runs the window assignment without auto-mounting.
    await freshImport("./snippets-panel");
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exposes __snippetsPanel on window after import", () => {
    expect(window.__snippetsPanel).toBeDefined();
    expect(typeof window.__snippetsPanel!.mount).toBe("function");
  });

  it("mount() renders into an existing DOM element", () => {
    const el = document.createElement("div");
    el.id = "test-snippets-mount";
    document.body.appendChild(el);

    window.__snippetsPanel!.mount("test-snippets-mount");

    // After mount the element should contain rendered content
    expect(el.innerHTML.length).toBeGreaterThan(0);
  });

  it("mount() clears previous content before rendering", () => {
    const el = document.createElement("div");
    el.id = "test-snippets-mount";
    el.innerHTML = "<p>Old content</p>";
    document.body.appendChild(el);

    window.__snippetsPanel!.mount("test-snippets-mount");

    expect(el.innerHTML).not.toContain("Old content");
  });

  it("mount() does nothing if element id does not exist", () => {
    // Should not throw when the element doesn't exist
    expect(() => {
      window.__snippetsPanel!.mount("nonexistent-element");
    }).not.toThrow();
  });

  it("auto-mounts when panel-snippets element exists at import time", async () => {
    // Clean window and modules
    delete window.__snippetsPanel;

    // Create the auto-mount target before importing
    const el = document.createElement("div");
    el.id = "panel-snippets";
    document.body.appendChild(el);

    installLocalStorageMock();
    await freshImport("./snippets-panel");

    // The auto-mount should have rendered into the element
    expect(el.innerHTML.length).toBeGreaterThan(0);
  });
});
