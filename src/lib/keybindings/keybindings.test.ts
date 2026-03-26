import { describe, it, expect, vi } from "vitest";
import { actions, type ActionId, type ActionCategory } from "./actions.ts";
import {
  defaultKeyBindings,
  defaultGamepadBindings,
} from "./defaults.ts";
import {
  detectOs,
  isBrowserReserved,
  isOsReserved,
  type OsFamily,
} from "./osReserved.ts";

// Mock heavy runtime dependencies that handlers.ts transitively imports.
// We only need to verify handler *keys* exist, not execute the handlers.
vi.mock("../../effects/editorEvaluation.ts", () => ({
  evaluate: vi.fn(() => true),
}));
vi.mock("../../editors/editorKeyboard.ts", () => ({
  toggleHelp: vi.fn(() => true),
  toggleSerialVis: vi.fn(() => true),
  showDocumentationForSymbol: vi.fn(() => true),
}));
vi.mock("../../editors/extensions/probes.ts", () => ({
  toggleCurrentProbe: vi.fn(() => true),
  expandCurrentProbeContext: vi.fn(() => true),
  contractCurrentProbeContext: vi.fn(() => true),
}));

// Import handlers after mocks are registered
import { handlers } from "./handlers.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allActionIds = Object.keys(actions) as ActionId[];

const validCategories: ActionCategory[] = [
  "core",
  "editor",
  "structure",
  "probe",
  "navigation",
  "ui",
  "transport",
  "gamepad",
  "menu",
];

// Actions not expected to have a handler in the handler registry.
// Picker/menu scoped actions are dispatched via their own channel subscribers.
// nav.home / nav.end are handled by CodeMirror's built-in defaultKeymap.
// edit.backspaceNormal is a conditional gate, not a handler-registry action.
const handlerExemptActions = new Set<string>([
  "picker.up",
  "picker.down",
  "picker.left",
  "picker.right",
  "picker.select",
  "picker.cancel",
  "menu.openBefore",
  "menu.openAfter",
  "menu.radial",
  "edit.backspaceNormal",
  "nav.home",
  "nav.end",
]);

// ---------------------------------------------------------------------------
// 1. Action registry completeness
// ---------------------------------------------------------------------------

describe("Action registry completeness", () => {
  it("has at least one action", () => {
    expect(allActionIds.length).toBeGreaterThan(0);
  });

  for (const id of allActionIds) {
    const def = actions[id];

    it(`${id} has a non-empty description`, () => {
      expect(typeof def.description).toBe("string");
      expect(def.description.trim().length).toBeGreaterThan(0);
    });

    it(`${id} has a valid category`, () => {
      expect(validCategories).toContain(def.category);
    });
  }
});

// ---------------------------------------------------------------------------
// 2. Default bindings reference valid actions
// ---------------------------------------------------------------------------

describe("Default bindings reference valid actions", () => {
  for (const binding of defaultKeyBindings) {
    it(`keyboard binding "${binding.key}" → "${binding.action}" is a valid ActionId`, () => {
      expect(allActionIds).toContain(binding.action);
    });
  }

  for (const binding of defaultGamepadBindings) {
    it(`gamepad binding [${binding.combo.join("+")}] → "${binding.action}" is a valid ActionId`, () => {
      expect(allActionIds).toContain(binding.action);
    });
  }
});

// ---------------------------------------------------------------------------
// 3. Handler coverage
// ---------------------------------------------------------------------------

describe("Handler coverage", () => {
  // Collect actions that have a default keyboard binding and are not exempt
  const boundActions = new Set(
    defaultKeyBindings
      .map((b) => b.action)
      .filter((a) => !handlerExemptActions.has(a)),
  );

  for (const actionId of boundActions) {
    it(`"${actionId}" has a registered handler`, () => {
      expect(handlers[actionId]).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// 4. No duplicate keys in same context
// ---------------------------------------------------------------------------

describe("No duplicate keys in same context", () => {
  it("no two defaultKeyBindings share the same key with overlapping when clauses", () => {
    // Group bindings by key
    const byKey = new Map<string, typeof defaultKeyBindings>();
    for (const binding of defaultKeyBindings) {
      const group = byKey.get(binding.key) ?? [];
      group.push(binding);
      byKey.set(binding.key, group);
    }

    const conflicts: string[] = [];

    for (const [key, bindings] of byKey) {
      if (bindings.length <= 1) continue;

      // Check all pairs for overlapping when clauses
      for (let i = 0; i < bindings.length; i++) {
        for (let j = i + 1; j < bindings.length; j++) {
          const a = bindings[i].when;
          const b = bindings[j].when;

          // Two bindings on the same key are OK only if their `when`
          // clauses are mutually exclusive. Heuristic: one is defined
          // and the other is not (they overlap), or both are undefined
          // (definitely overlap). If both are defined, check whether
          // one is the negation of the other.
          const areMutuallyExclusive =
            a !== undefined &&
            b !== undefined &&
            (a === `!${b}` || b === `!${a}`);

          if (!areMutuallyExclusive) {
            conflicts.push(
              `"${key}": "${bindings[i].action}" (when: ${a ?? "always"}) vs "${bindings[j].action}" (when: ${b ?? "always"})`,
            );
          }
        }
      }
    }

    expect(conflicts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 5. OS reserved keys module
// ---------------------------------------------------------------------------

describe("OS reserved keys module", () => {
  it("detectOs() returns a valid OsFamily", () => {
    const validFamilies: OsFamily[] = ["mac", "windows", "linux"];
    expect(validFamilies).toContain(detectOs());
  });

  it('isBrowserReserved("Ctrl-w") returns a result', () => {
    const result = isBrowserReserved("Ctrl-w");
    expect(result).not.toBeNull();
    expect(result!.key).toBe("Ctrl-w");
  });

  it('isBrowserReserved("Alt-p") returns null', () => {
    expect(isBrowserReserved("Alt-p")).toBeNull();
  });

  it('isOsReserved("Mod-q", "mac") returns a result', () => {
    const result = isOsReserved("Mod-q", "mac");
    expect(result).not.toBeNull();
    expect(result!.key).toBe("Mod-q");
  });
});

// ---------------------------------------------------------------------------
// 6. Snapshot: all default keyboard binding keys
// ---------------------------------------------------------------------------

describe("Default keyboard binding key snapshot", () => {
  it("matches the known set of binding keys", () => {
    const sortedKeys = defaultKeyBindings.map((b) => b.key).sort();
    expect(sortedKeys).toMatchInlineSnapshot(`
      [
        "Alt-/",
        "Alt-Enter",
        "Alt-Shift-p",
        "Alt-e '",
        "Alt-e ;",
        "Alt-e [",
        "Alt-e ]",
        "Alt-f",
        "Alt-g",
        "Alt-h",
        "Alt-o h",
        "Alt-o p",
        "Alt-o r",
        "Alt-o s",
        "Alt-p",
        "Alt-s",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "ArrowUp",
        "Backspace",
        "Ctrl-'",
        "Ctrl-;",
        "Ctrl-[",
        "Ctrl-]",
        "Ctrl-k",
        "End",
        "Enter",
        "Escape",
        "Home",
        "Mod-Enter",
        "Mod-Shift-Enter",
        "Mod-Shift-p",
        "Mod-z",
        "Shift-Mod-z",
      ]
    `);
  });
});
