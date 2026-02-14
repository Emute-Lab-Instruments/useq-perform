import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Dynamic-import an island module with a fresh module graph so that
 * top-level side-effects (render calls) re-execute.
 */
async function freshImport(modulePath: string) {
  vi.resetModules();
  return import(modulePath);
}

// ---------------------------------------------------------------------------
// 1. VirtualGamepad  (src/ui/VirtualGamepad.tsx)
// ---------------------------------------------------------------------------

describe("VirtualGamepad exports", () => {
  let get: () => any;
  let set: (state: any) => void;
  let reset: () => void;

  beforeEach(async () => {
    const mod = await freshImport("../ui/VirtualGamepad");
    get = mod.getVirtualGamepadState;
    set = mod.setVirtualGamepadState;
    reset = mod.resetVirtualGamepadState;
    reset();
  });

  it("exports get/set/reset functions", () => {
    expect(typeof get).toBe("function");
    expect(typeof set).toBe("function");
    expect(typeof reset).toBe("function");
  });

  it("get() returns default state with 17 buttons and 4 axes", () => {
    const state = get();
    expect(state.buttons).toHaveLength(17);
    expect(state.axes).toEqual([0, 0, 0, 0]);
    state.buttons.forEach((btn: any) => {
      expect(btn.pressed).toBe(false);
      expect(btn.value).toBe(0);
    });
  });

  it("set() merges partial state and updates timestamp", () => {
    const before = get();
    set({ axes: [1, -1, 0.5, -0.5] });
    const after = get();

    expect(after.axes).toEqual([1, -1, 0.5, -0.5]);
    expect(after.buttons).toHaveLength(17);
    expect(after.timestamp).toBeGreaterThanOrEqual(before.timestamp);
  });

  it("set() can update buttons", () => {
    const newButtons = Array.from({ length: 17 }, (_, i) => ({
      pressed: i === 0,
      value: i === 0 ? 1 : 0,
    }));
    set({ buttons: newButtons });

    const state = get();
    expect(state.buttons[0].pressed).toBe(true);
    expect(state.buttons[0].value).toBe(1);
    expect(state.buttons[1].pressed).toBe(false);
  });

  it("reset() restores default state", () => {
    set({ axes: [1, 1, 1, 1] });
    expect(get().axes).toEqual([1, 1, 1, 1]);

    reset();
    const state = get();
    expect(state.axes).toEqual([0, 0, 0, 0]);
    state.buttons.forEach((btn: any) => {
      expect(btn.pressed).toBe(false);
      expect(btn.value).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// 2. Modal island  (src/islands/modal.tsx)
// ---------------------------------------------------------------------------

describe("modal island exports", () => {
  let showModal: (id: string, title: string, content: string) => void;
  let closeModal: (id: string) => void;

  beforeEach(async () => {
    document.getElementById("solid-modal-root")?.remove();
    const mod = await freshImport("./modal");
    showModal = mod.showModal;
    closeModal = mod.closeModal;
  });

  it("exports showModal and closeModal functions", () => {
    expect(typeof showModal).toBe("function");
    expect(typeof closeModal).toBe("function");
  });

  it("creates a solid-modal-root element in the DOM", () => {
    const root = document.getElementById("solid-modal-root");
    expect(root).toBeTruthy();
    expect(root!.style.position).toBe("fixed");
  });

  it("showModal() does not throw", () => {
    expect(() => {
      showModal("test-id", "Test Title", "<p>Hello</p>");
    }).not.toThrow();
  });

  it("closeModal() does not throw", () => {
    showModal("test-id", "Test Title", "<p>Hello</p>");
    expect(() => {
      closeModal("test-id");
    }).not.toThrow();
  });

  it("showModal renders content into the root, closeModal removes it", () => {
    const root = document.getElementById("solid-modal-root")!;

    showModal("m1", "My Modal", "<p>Body text</p>");
    expect(root.innerHTML.length).toBeGreaterThan(0);

    closeModal("m1");
    expect(root.innerHTML).toBe("");
  });
});

// ---------------------------------------------------------------------------
// 3. Picker menu island  (src/islands/picker-menu.tsx)
// ---------------------------------------------------------------------------

describe("picker-menu island exports", () => {
  let showPickerMenu: any;
  let showNumberPickerMenu: any;
  let showHierarchicalGridPicker: any;
  let close: any;

  beforeEach(async () => {
    document.getElementById("picker-menu-root")?.remove();
    const mod = await freshImport("./picker-menu");
    showPickerMenu = mod.showPickerMenu;
    showNumberPickerMenu = mod.showNumberPickerMenu;
    showHierarchicalGridPicker = mod.showHierarchicalGridPicker;
    close = mod.close;
  });

  it("exports picker menu functions", () => {
    expect(typeof showPickerMenu).toBe("function");
    expect(typeof showNumberPickerMenu).toBe("function");
    expect(typeof showHierarchicalGridPicker).toBe("function");
    expect(typeof close).toBe("function");
  });

  it("creates a picker-menu-root element in the DOM", () => {
    const root = document.getElementById("picker-menu-root");
    expect(root).toBeTruthy();
    expect(root!.style.zIndex).toBe("1000");
  });

  it("showPickerMenu() returns a close function", () => {
    const closeFn = showPickerMenu({
      items: [{ label: "Item A" }, { label: "Item B" }],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
  });

  it("showPickerMenu() with empty items returns a no-op close function", () => {
    const closeFn = showPickerMenu({
      items: [],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
    expect(() => closeFn()).not.toThrow();
  });

  it("showNumberPickerMenu() returns a close function", () => {
    const closeFn = showNumberPickerMenu({
      onSelect: vi.fn(),
      title: "Pick a number",
      min: 0,
      max: 100,
    });
    expect(typeof closeFn).toBe("function");
  });

  it("showHierarchicalGridPicker() returns a close function", () => {
    const closeFn = showHierarchicalGridPicker({
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
    const closeFn = showHierarchicalGridPicker({
      categories: [],
      onSelect: vi.fn(),
    });
    expect(typeof closeFn).toBe("function");
    expect(() => closeFn()).not.toThrow();
  });

  it("close() does not throw when no menu is open", () => {
    expect(() => close()).not.toThrow();
  });

  it("close() works after opening a menu", () => {
    showPickerMenu({
      items: [{ label: "X" }],
      onSelect: vi.fn(),
    });
    expect(() => close()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. Double radial menu island  (src/islands/double-radial-menu.tsx)
// ---------------------------------------------------------------------------

describe("double-radial-menu island exports", () => {
  let open: any;
  let close: any;

  beforeEach(async () => {
    document.getElementById("double-radial-menu-root")?.remove();
    document.body.style.overflow = "";
    const mod = await freshImport("./double-radial-menu");
    open = mod.open;
    close = mod.close;
  });

  it("exports open and close functions", () => {
    expect(typeof open).toBe("function");
    expect(typeof close).toBe("function");
  });

  it("creates a double-radial-menu-root element in the DOM", () => {
    const root = document.getElementById("double-radial-menu-root");
    expect(root).toBeTruthy();
    expect(root!.style.zIndex).toBe("1100");
  });

  it("open() returns a close function", () => {
    const closeFn = open({
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
    open({
      categories: [{ label: "Cat", items: [{ label: "X" }] }],
    });
    expect(document.body.style.overflow).toBe("hidden");
  });

  it("close() unlocks body scroll", () => {
    document.body.style.overflow = "auto";
    open({
      categories: [{ label: "Cat", items: [{ label: "X" }] }],
    });
    expect(document.body.style.overflow).toBe("hidden");

    close();
    expect(document.body.style.overflow).toBe("auto");
  });

  it("returned close function also unlocks scroll", () => {
    document.body.style.overflow = "scroll";
    const closeFn = open({
      categories: [{ label: "Cat", items: [{ label: "X" }] }],
    });
    expect(document.body.style.overflow).toBe("hidden");

    closeFn();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("close() does not throw when menu is not open", () => {
    expect(() => close()).not.toThrow();
  });

  it("open() accepts optional callbacks without throwing", () => {
    const onSelect = vi.fn();
    const onCancel = vi.fn();
    expect(() => {
      open({
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
// 5. Snippets panel island  (src/islands/snippets-panel.tsx)
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

describe("snippets-panel island exports", () => {
  let mountSnippetsPanel: (elementId: string) => void;

  beforeEach(async () => {
    vi.useFakeTimers();

    document.getElementById("panel-snippets")?.remove();
    document.getElementById("test-snippets-mount")?.remove();
    installLocalStorageMock();
    const mod = await freshImport("./snippets-panel");
    mountSnippetsPanel = mod.mountSnippetsPanel;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("exports mountSnippetsPanel function", () => {
    expect(typeof mountSnippetsPanel).toBe("function");
  });

  it("mount() renders into an existing DOM element", () => {
    const el = document.createElement("div");
    el.id = "test-snippets-mount";
    document.body.appendChild(el);

    mountSnippetsPanel("test-snippets-mount");

    expect(el.innerHTML.length).toBeGreaterThan(0);
  });

  it("mount() clears previous content before rendering", () => {
    const el = document.createElement("div");
    el.id = "test-snippets-mount";
    el.innerHTML = "<p>Old content</p>";
    document.body.appendChild(el);

    mountSnippetsPanel("test-snippets-mount");

    expect(el.innerHTML).not.toContain("Old content");
  });

  it("mount() does nothing if element id does not exist", () => {
    expect(() => {
      mountSnippetsPanel("nonexistent-element");
    }).not.toThrow();
  });

  it("auto-mounts when panel-snippets element exists at import time", async () => {
    const el = document.createElement("div");
    el.id = "panel-snippets";
    document.body.appendChild(el);

    installLocalStorageMock();
    await freshImport("./snippets-panel");

    expect(el.innerHTML.length).toBeGreaterThan(0);
  });
});
