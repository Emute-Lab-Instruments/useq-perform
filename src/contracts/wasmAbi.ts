/**
 * Canonical WASM ABI contract for the editor-facing uSEQ WASM module.
 *
 * This file is the single source of truth for which symbols the editor
 * may assume are exported by the Emscripten-generated WASM bundle and
 * how they should be called via `cwrap`.
 *
 * The ABI floor is pinned to what `src-useq/scripts/build_wasm.sh`
 * actually exports via `-s EXPORTED_FUNCTIONS`. Any symbol not in that
 * list is _optional_ and must be probed at instantiation time.
 *
 * @see docs/RUNTIME_CONTRACT.md — "WASM ABI Contract" section
 * @see src-useq/scripts/build_wasm.sh — EXPORTED_FUNCTIONS list
 * @see src-useq/wasm/wasm_wrapper.cpp — C extern definitions
 */

// ---------------------------------------------------------------------------
// Emscripten cwrap signature descriptors
// ---------------------------------------------------------------------------

/** A single cwrap binding descriptor. */
export interface CwrapDescriptor {
  /** The C symbol name (without leading underscore). */
  readonly symbol: string;
  /** The Emscripten return type string passed to cwrap. */
  readonly returnType: string | null;
  /** The Emscripten argument type strings passed to cwrap. */
  readonly argTypes: readonly string[];
}

// ---------------------------------------------------------------------------
// Required ABI — guaranteed by the build script export list
// ---------------------------------------------------------------------------

/**
 * Required WASM exports. These symbols are in the Emscripten
 * `-s EXPORTED_FUNCTIONS` list and MUST be present in every conforming
 * WASM bundle.
 *
 * Order matches `build_wasm.sh`:
 *   _useq_init, _useq_eval, _useq_update_time, _useq_eval_output, _free
 */
export const REQUIRED_WASM_EXPORTS = Object.freeze({
  useq_init: {
    symbol: "useq_init",
    returnType: null,
    argTypes: [],
  },
  useq_eval: {
    symbol: "useq_eval",
    returnType: "string",
    argTypes: ["string"],
  },
  useq_update_time: {
    symbol: "useq_update_time",
    returnType: null,
    argTypes: ["number"],
  },
  useq_eval_output: {
    symbol: "useq_eval_output",
    returnType: "number",
    argTypes: ["string", "number"],
  },
} as const satisfies Record<string, CwrapDescriptor>);

/** Names of all required WASM exports. */
export type RequiredWasmExport = keyof typeof REQUIRED_WASM_EXPORTS;

/** Ordered list of required export symbol names for iteration. */
export const REQUIRED_WASM_EXPORT_NAMES = Object.freeze(
  Object.keys(REQUIRED_WASM_EXPORTS) as RequiredWasmExport[]
);

// ---------------------------------------------------------------------------
// Emscripten runtime methods the module must also expose
// ---------------------------------------------------------------------------

/**
 * Emscripten runtime methods the editor depends on.
 * These correspond to `-s EXPORTED_RUNTIME_METHODS` in the build script.
 */
export const REQUIRED_RUNTIME_METHODS = Object.freeze([
  "ccall",
  "cwrap",
  "UTF8ToString",
] as const);

export type RequiredRuntimeMethod = (typeof REQUIRED_RUNTIME_METHODS)[number];

// ---------------------------------------------------------------------------
// Emscripten heap helpers — always available on a conforming module
// ---------------------------------------------------------------------------

/**
 * Low-level Emscripten helpers the bridge uses for typed-array batch
 * evaluation. `_malloc` and `_free` are both explicitly listed in
 * EXPORTED_FUNCTIONS in build_wasm.sh.
 */
export const REQUIRED_HEAP_HELPERS = Object.freeze([
  "_malloc",
  "_free",
] as const);

export type RequiredHeapHelper = (typeof REQUIRED_HEAP_HELPERS)[number];

// ---------------------------------------------------------------------------
// Optional ABI — present in wasm_wrapper.cpp but NOT in build exports
// ---------------------------------------------------------------------------

/**
 * Optional WASM exports. These are compiled into the wrapper but are
 * NOT listed in `-s EXPORTED_FUNCTIONS` today, so they may or may not
 * be reachable depending on link-time dead-code elimination.
 *
 * The editor MUST probe for these at instantiation and degrade
 * gracefully if they are missing.
 */
export const OPTIONAL_WASM_EXPORTS = Object.freeze({
  useq_eval_outputs_time_window: {
    symbol: "useq_eval_outputs_time_window",
    returnType: "string",
    argTypes: ["string", "number", "number", "number"],
  },
  useq_eval_outputs_time_window_into: {
    symbol: "useq_eval_outputs_time_window_into",
    returnType: "number",
    argTypes: ["string", "number", "number", "number", "number", "number"],
  },
  useq_last_error: {
    symbol: "useq_last_error",
    returnType: "string",
    argTypes: [],
  },
} as const satisfies Record<string, CwrapDescriptor>);

export type OptionalWasmExport = keyof typeof OPTIONAL_WASM_EXPORTS;

export const OPTIONAL_WASM_EXPORT_NAMES = Object.freeze(
  Object.keys(OPTIONAL_WASM_EXPORTS) as OptionalWasmExport[]
);

// ---------------------------------------------------------------------------
// Minimal module shape expected after Emscripten instantiation
// ---------------------------------------------------------------------------

/** Minimal Emscripten module interface the editor depends on. */
export interface EmscriptenModuleShape {
  cwrap(
    symbol: string,
    returnType: string | null,
    argTypes: string[]
  ): (...args: any[]) => any;
  _malloc(size: number): number;
  _free(pointer: number): void;
  HEAPF64: Float64Array;
}

// ---------------------------------------------------------------------------
// ABI validation
// ---------------------------------------------------------------------------

/** Result of an ABI validation check. */
export interface WasmAbiValidation {
  /** True when all required exports are present. */
  readonly valid: boolean;
  /** Symbol names that are required but missing. */
  readonly missingRequired: readonly string[];
  /** Symbol names that are optional and were detected. */
  readonly presentOptional: readonly string[];
  /** Symbol names that are optional and were NOT detected. */
  readonly missingOptional: readonly string[];
}

/**
 * Validate that an Emscripten module conforms to the canonical WASM ABI.
 *
 * This should be called immediately after `createModule()` resolves,
 * BEFORE calling `useq_init()`. If validation fails the caller should
 * refuse to use the module — the ABI has drifted.
 *
 * Required symbols are tested via `cwrap`; if cwrap throws the symbol
 * is considered missing. Optional symbols are probed via `tryCwrap`-style
 * try/catch.
 */
export function validateWasmAbi(
  module: EmscriptenModuleShape
): WasmAbiValidation {
  const missingRequired: string[] = [];
  const presentOptional: string[] = [];
  const missingOptional: string[] = [];

  // --- Probe required exports ---
  for (const desc of Object.values(REQUIRED_WASM_EXPORTS)) {
    try {
      const fn = module.cwrap(
        desc.symbol,
        desc.returnType,
        desc.argTypes as unknown as string[]
      );
      if (typeof fn !== "function") {
        missingRequired.push(desc.symbol);
      }
    } catch {
      missingRequired.push(desc.symbol);
    }
  }

  // --- Probe heap helpers ---
  for (const helper of REQUIRED_HEAP_HELPERS) {
    // _malloc and _free are direct properties, not cwrap targets
    const prop = helper as keyof EmscriptenModuleShape;
    if (typeof (module as any)[prop] !== "function") {
      missingRequired.push(helper);
    }
  }

  // --- Probe optional exports ---
  for (const desc of Object.values(OPTIONAL_WASM_EXPORTS)) {
    try {
      const fn = module.cwrap(
        desc.symbol,
        desc.returnType,
        desc.argTypes as unknown as string[]
      );
      if (typeof fn === "function") {
        presentOptional.push(desc.symbol);
      } else {
        missingOptional.push(desc.symbol);
      }
    } catch {
      missingOptional.push(desc.symbol);
    }
  }

  return Object.freeze({
    valid: missingRequired.length === 0,
    missingRequired: Object.freeze(missingRequired),
    presentOptional: Object.freeze(presentOptional),
    missingOptional: Object.freeze(missingOptional),
  });
}

/**
 * Assert that the WASM ABI is valid or throw a descriptive error.
 *
 * Use this at instantiation time to fail fast when the WASM bundle
 * does not match what the editor expects.
 */
export function assertWasmAbi(module: EmscriptenModuleShape): WasmAbiValidation {
  const result = validateWasmAbi(module);
  if (!result.valid) {
    throw new Error(
      `WASM ABI validation failed — missing required exports: ${result.missingRequired.join(", ")}. ` +
        `The WASM bundle does not match the editor's expected ABI. ` +
        `See src/contracts/wasmAbi.ts and docs/RUNTIME_CONTRACT.md.`
    );
  }
  return result;
}

// ---------------------------------------------------------------------------
// Static contract assertions (run at module load time)
// ---------------------------------------------------------------------------

/**
 * Verify internal consistency of the ABI contract constants.
 * Throws if the contract definitions are internally inconsistent.
 */
export function assertWasmAbiContract(): void {
  // Required export names must be unique
  const requiredSet = new Set(REQUIRED_WASM_EXPORT_NAMES);
  if (requiredSet.size !== REQUIRED_WASM_EXPORT_NAMES.length) {
    throw new Error("Required WASM export names must be unique");
  }

  // Optional export names must be unique
  const optionalSet = new Set(OPTIONAL_WASM_EXPORT_NAMES);
  if (optionalSet.size !== OPTIONAL_WASM_EXPORT_NAMES.length) {
    throw new Error("Optional WASM export names must be unique");
  }

  // No overlap between required and optional
  for (const name of OPTIONAL_WASM_EXPORT_NAMES) {
    if (requiredSet.has(name as any)) {
      throw new Error(
        `Symbol "${name}" appears in both required and optional WASM exports`
      );
    }
  }

  // Every descriptor must have a non-empty symbol
  for (const desc of [
    ...Object.values(REQUIRED_WASM_EXPORTS),
    ...Object.values(OPTIONAL_WASM_EXPORTS),
  ]) {
    if (!desc.symbol || typeof desc.symbol !== "string") {
      throw new Error("Every WASM ABI descriptor must have a non-empty symbol");
    }
  }

  // Runtime methods must be unique
  if (new Set(REQUIRED_RUNTIME_METHODS).size !== REQUIRED_RUNTIME_METHODS.length) {
    throw new Error("Required runtime methods must be unique");
  }

  // Heap helpers must be unique
  if (new Set(REQUIRED_HEAP_HELPERS).size !== REQUIRED_HEAP_HELPERS.length) {
    throw new Error("Required heap helpers must be unique");
  }
}

// Run static assertion at module load
assertWasmAbiContract();
