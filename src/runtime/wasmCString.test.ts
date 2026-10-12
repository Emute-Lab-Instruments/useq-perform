import { describe, expect, it, vi } from "vitest";
import { readAndFreeCString, type EmscriptenModule } from "./wasmInterpreterCore";

describe("readAndFreeCString", () => {
  it("copies the string before releasing its WASM allocation", () => {
    const module = {
      UTF8ToString: vi.fn(() => "ok"),
      _free: vi.fn(),
    } as unknown as EmscriptenModule;

    expect(readAndFreeCString(module, 42)).toBe("ok");
    expect(module.UTF8ToString).toHaveBeenCalledWith(42);
    expect(module._free).toHaveBeenCalledWith(42);
  });

  it("does not try to decode or free a null pointer", () => {
    const module = {
      UTF8ToString: vi.fn(),
      _free: vi.fn(),
    } as unknown as EmscriptenModule;

    expect(readAndFreeCString(module, 0)).toBe("");
    expect(module.UTF8ToString).not.toHaveBeenCalled();
    expect(module._free).not.toHaveBeenCalled();
  });
});
