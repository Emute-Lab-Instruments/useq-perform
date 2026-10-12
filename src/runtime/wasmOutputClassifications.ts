import { OPTIONAL_WASM_EXPORTS } from "../contracts/wasmAbi";
import { OutputClass, type OutputClassification } from "../contracts/runtimePorts";
import {
  bindOptionalCwrap,
  type EmscriptenModule,
} from "./wasmInterpreterCore";

const OUTPUT_COUNT = 42;
const NAMED_OUTPUTS = ["a", "d", "s"].flatMap((prefix) =>
  Array.from({ length: 8 }, (_, index) => `${prefix}${index + 1}`),
);

/** Bind the visualisation metadata ABI and return a snapshot reader. */
export function bindOutputClassifications(
  module: EmscriptenModule,
): () => OutputClassification | null {
  const classificationsFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_output_classifications,
  ) as (() => number) | null;
  const dependenciesFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_output_dependencies,
  ) as ((index: number) => number) | null;
  const healthFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_output_health,
  ) as ((name: string) => number) | null;
  const semanticEffectsFn = bindOptionalCwrap(
    module,
    OPTIONAL_WASM_EXPORTS.useq_output_semantic_effects,
  ) as ((index: number) => number) | null;

  return () => {
    if (!classificationsFn || !module.HEAPU8) return null;
    try {
      const pointer = classificationsFn();
      if (!pointer) return null;
      const raw = module.HEAPU8.slice(pointer, pointer + OUTPUT_COUNT);
      if (raw.length !== OUTPUT_COUNT) return null;
      const classes = Array.from(raw, (value) => {
        if (value === 1) return OutputClass.Pure;
        if (value === 2) return OutputClass.InputDep;
        if (value === 3) return OutputClass.Stateful;
        return OutputClass.Inactive;
      });
      const inputMasks = Array.from(
        { length: OUTPUT_COUNT },
        (_, index) => dependenciesFn?.(index) ?? 0,
      );
      const semanticEffects = Array.from(
        { length: OUTPUT_COUNT },
        (_, index) => semanticEffectsFn?.(index) ?? 0,
      );
      const outputHealth: Record<string, number> = {};
      for (const name of NAMED_OUTPUTS) {
        const health = healthFn?.(name);
        if (typeof health === "number") outputHealth[name] = health;
      }
      return { classes, inputMasks, outputHealth, semanticEffects };
    } catch {
      return null;
    }
  };
}
