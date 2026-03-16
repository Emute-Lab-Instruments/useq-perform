import { describe, expect, it, vi } from "vitest";

import {
  assertWasmAbi,
  assertWasmAbiContract,
  OPTIONAL_WASM_EXPORT_NAMES,
  OPTIONAL_WASM_EXPORTS,
  REQUIRED_HEAP_HELPERS,
  REQUIRED_RUNTIME_METHODS,
  REQUIRED_WASM_EXPORT_NAMES,
  REQUIRED_WASM_EXPORTS,
  validateWasmAbi,
  type CwrapDescriptor,
  type EmscriptenModuleShape,
  type WasmAbiValidation,
} from "./wasmAbi";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal mock module where cwrap always succeeds. */
function createMockModule(
  overrides: Partial<Record<string, "missing" | "throws">> = {}
): EmscriptenModuleShape {
  const cwrap = vi.fn(
    (symbol: string, _ret: string | null, _args: string[]) => {
      const override = overrides[symbol];
      if (override === "throws") {
        throw new Error(`${symbol} is not exported`);
      }
      if (override === "missing") {
        return undefined; // non-function return
      }
      return vi.fn(); // valid function
    }
  );

  return {
    cwrap,
    _malloc: vi.fn((size: number) => size > 0 ? 1024 : 0),
    _free: vi.fn(),
    HEAPF64: new Float64Array(128),
  } as unknown as EmscriptenModuleShape;
}

// ---------------------------------------------------------------------------
// Contract consistency (static assertions)
// ---------------------------------------------------------------------------

describe("wasmAbi contract consistency", () => {
  it("static assertion passes at module load", () => {
    // The module already runs assertWasmAbiContract() on import.
    // Calling it again should also not throw.
    expect(() => assertWasmAbiContract()).not.toThrow();
  });

  it("required export names are unique", () => {
    const set = new Set(REQUIRED_WASM_EXPORT_NAMES);
    expect(set.size).toBe(REQUIRED_WASM_EXPORT_NAMES.length);
  });

  it("optional export names are unique", () => {
    const set = new Set(OPTIONAL_WASM_EXPORT_NAMES);
    expect(set.size).toBe(OPTIONAL_WASM_EXPORT_NAMES.length);
  });

  it("no overlap between required and optional exports", () => {
    const requiredSet = new Set<string>(REQUIRED_WASM_EXPORT_NAMES);
    for (const name of OPTIONAL_WASM_EXPORT_NAMES) {
      expect(requiredSet.has(name)).toBe(false);
    }
  });

  it("every descriptor has a non-empty symbol string", () => {
    const all: CwrapDescriptor[] = [
      ...Object.values(REQUIRED_WASM_EXPORTS),
      ...Object.values(OPTIONAL_WASM_EXPORTS),
    ];
    for (const desc of all) {
      expect(typeof desc.symbol).toBe("string");
      expect(desc.symbol.length).toBeGreaterThan(0);
    }
  });

  it("every descriptor has an argTypes array", () => {
    const all: CwrapDescriptor[] = [
      ...Object.values(REQUIRED_WASM_EXPORTS),
      ...Object.values(OPTIONAL_WASM_EXPORTS),
    ];
    for (const desc of all) {
      expect(Array.isArray(desc.argTypes)).toBe(true);
    }
  });

  it("runtime methods are unique", () => {
    expect(new Set(REQUIRED_RUNTIME_METHODS).size).toBe(
      REQUIRED_RUNTIME_METHODS.length
    );
  });

  it("heap helpers are unique", () => {
    expect(new Set(REQUIRED_HEAP_HELPERS).size).toBe(
      REQUIRED_HEAP_HELPERS.length
    );
  });
});

// ---------------------------------------------------------------------------
// Required ABI surface
// ---------------------------------------------------------------------------

describe("REQUIRED_WASM_EXPORTS", () => {
  it("contains useq_init with correct signature", () => {
    const desc = REQUIRED_WASM_EXPORTS.useq_init;
    expect(desc.symbol).toBe("useq_init");
    expect(desc.returnType).toBeNull();
    expect(desc.argTypes).toEqual([]);
  });

  it("contains useq_eval with correct signature", () => {
    const desc = REQUIRED_WASM_EXPORTS.useq_eval;
    expect(desc.symbol).toBe("useq_eval");
    expect(desc.returnType).toBe("string");
    expect(desc.argTypes).toEqual(["string"]);
  });

  it("contains useq_update_time with correct signature", () => {
    const desc = REQUIRED_WASM_EXPORTS.useq_update_time;
    expect(desc.symbol).toBe("useq_update_time");
    expect(desc.returnType).toBeNull();
    expect(desc.argTypes).toEqual(["number"]);
  });

  it("contains useq_eval_output with correct signature", () => {
    const desc = REQUIRED_WASM_EXPORTS.useq_eval_output;
    expect(desc.symbol).toBe("useq_eval_output");
    expect(desc.returnType).toBe("number");
    expect(desc.argTypes).toEqual(["string", "number"]);
  });

  it("matches the build script EXPORTED_FUNCTIONS list", () => {
    // The build script exports: _useq_init, _useq_eval, _useq_update_time,
    // _useq_eval_output, _free
    // _free is a heap helper, not a cwrap target.
    const buildScriptSymbols = new Set([
      "useq_init",
      "useq_eval",
      "useq_update_time",
      "useq_eval_output",
    ]);
    const contractSymbols = new Set(REQUIRED_WASM_EXPORT_NAMES);
    expect(contractSymbols).toEqual(buildScriptSymbols);
  });
});

// ---------------------------------------------------------------------------
// Optional ABI surface
// ---------------------------------------------------------------------------

describe("OPTIONAL_WASM_EXPORTS", () => {
  it("includes batch evaluation helpers", () => {
    expect(OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window).toBeDefined();
    expect(OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window_into).toBeDefined();
  });

  it("includes error reporting helper", () => {
    expect(OPTIONAL_WASM_EXPORTS.useq_last_error).toBeDefined();
  });

  it("useq_eval_outputs_time_window has correct signature", () => {
    const desc = OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window;
    expect(desc.returnType).toBe("string");
    expect(desc.argTypes).toEqual(["string", "number", "number", "number"]);
  });

  it("useq_eval_outputs_time_window_into has correct signature", () => {
    const desc = OPTIONAL_WASM_EXPORTS.useq_eval_outputs_time_window_into;
    expect(desc.returnType).toBe("number");
    expect(desc.argTypes).toEqual([
      "string",
      "number",
      "number",
      "number",
      "number",
      "number",
    ]);
  });

  it("useq_last_error has correct signature", () => {
    const desc = OPTIONAL_WASM_EXPORTS.useq_last_error;
    expect(desc.returnType).toBe("string");
    expect(desc.argTypes).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Heap helpers
// ---------------------------------------------------------------------------

describe("REQUIRED_HEAP_HELPERS", () => {
  it("includes _malloc and _free", () => {
    expect(REQUIRED_HEAP_HELPERS).toContain("_malloc");
    expect(REQUIRED_HEAP_HELPERS).toContain("_free");
  });

  it("has exactly 2 entries", () => {
    expect(REQUIRED_HEAP_HELPERS.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Runtime methods
// ---------------------------------------------------------------------------

describe("REQUIRED_RUNTIME_METHODS", () => {
  it("includes cwrap, ccall, and UTF8ToString", () => {
    expect(REQUIRED_RUNTIME_METHODS).toContain("cwrap");
    expect(REQUIRED_RUNTIME_METHODS).toContain("ccall");
    expect(REQUIRED_RUNTIME_METHODS).toContain("UTF8ToString");
  });
});

// ---------------------------------------------------------------------------
// validateWasmAbi
// ---------------------------------------------------------------------------

describe("validateWasmAbi", () => {
  it("returns valid for a fully conforming module", () => {
    const module = createMockModule();
    const result = validateWasmAbi(module);
    expect(result.valid).toBe(true);
    expect(result.missingRequired).toEqual([]);
    // All optional are present in the mock (cwrap succeeds for any symbol)
    expect(result.presentOptional.length).toBe(OPTIONAL_WASM_EXPORT_NAMES.length);
    expect(result.missingOptional).toEqual([]);
  });

  it("detects missing required export (cwrap throws)", () => {
    const module = createMockModule({ useq_init: "throws" });
    const result = validateWasmAbi(module);
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("useq_init");
  });

  it("detects missing required export (cwrap returns non-function)", () => {
    const module = createMockModule({ useq_eval: "missing" });
    const result = validateWasmAbi(module);
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("useq_eval");
  });

  it("detects missing _malloc", () => {
    const module = createMockModule();
    (module as any)._malloc = undefined;
    const result = validateWasmAbi(module);
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("_malloc");
  });

  it("detects missing _free", () => {
    const module = createMockModule();
    (module as any)._free = "not-a-function";
    const result = validateWasmAbi(module);
    expect(result.valid).toBe(false);
    expect(result.missingRequired).toContain("_free");
  });

  it("reports optional exports that throw as missing", () => {
    const module = createMockModule({
      useq_eval_outputs_time_window: "throws",
      useq_last_error: "throws",
    });
    const result = validateWasmAbi(module);
    // Still valid — only required matter
    expect(result.valid).toBe(true);
    expect(result.missingOptional).toContain("useq_eval_outputs_time_window");
    expect(result.missingOptional).toContain("useq_last_error");
    expect(result.presentOptional).toContain(
      "useq_eval_outputs_time_window_into"
    );
  });

  it("accumulates multiple missing required exports", () => {
    const module = createMockModule({
      useq_init: "throws",
      useq_eval: "throws",
      useq_update_time: "missing",
    });
    const result = validateWasmAbi(module);
    expect(result.valid).toBe(false);
    expect(result.missingRequired.length).toBe(3);
    expect(result.missingRequired).toContain("useq_init");
    expect(result.missingRequired).toContain("useq_eval");
    expect(result.missingRequired).toContain("useq_update_time");
  });

  it("returns a frozen result object", () => {
    const module = createMockModule();
    const result = validateWasmAbi(module);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.missingRequired)).toBe(true);
    expect(Object.isFrozen(result.presentOptional)).toBe(true);
    expect(Object.isFrozen(result.missingOptional)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// assertWasmAbi
// ---------------------------------------------------------------------------

describe("assertWasmAbi", () => {
  it("does not throw for a conforming module", () => {
    const module = createMockModule();
    expect(() => assertWasmAbi(module)).not.toThrow();
  });

  it("returns the validation result on success", () => {
    const module = createMockModule();
    const result = assertWasmAbi(module);
    expect(result.valid).toBe(true);
  });

  it("throws for a non-conforming module", () => {
    const module = createMockModule({ useq_eval: "throws" });
    expect(() => assertWasmAbi(module)).toThrow(/WASM ABI validation failed/);
    expect(() => assertWasmAbi(module)).toThrow(/useq_eval/);
  });

  it("error message references docs", () => {
    const module = createMockModule({ useq_init: "throws" });
    try {
      assertWasmAbi(module);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("src/contracts/wasmAbi.ts");
      expect(e.message).toContain("docs/RUNTIME_CONTRACT.md");
    }
  });

  it("lists all missing symbols in the error", () => {
    const module = createMockModule({
      useq_init: "throws",
      useq_update_time: "throws",
    });
    try {
      assertWasmAbi(module);
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("useq_init");
      expect(e.message).toContain("useq_update_time");
    }
  });
});
