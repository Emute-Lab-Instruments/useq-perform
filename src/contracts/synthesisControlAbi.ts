/**
 * Public synthesis SharedArrayBuffer control ABI.
 *
 * Keep consumers on this stable import path. Internally, `layout` owns byte
 * definitions and buffer validation, `view` owns typed ring access, and
 * `pacing` owns the Worker-only wait helper plus static invariant checks.
 */

export * from "./synthesisControlAbi/layout.ts";
export * from "./synthesisControlAbi/view.ts";
export * from "./synthesisControlAbi/pacing.ts";
