/**
 * Compiler-control to producer-SAB mapping.
 *
 * The compiler's `controls` array is the positional ABI for
 * `useq_tick_synth_controls`. The producer publishes only block-rate rows to
 * its SAB pool, so every retained row carries its original compiler index.
 */
import type {
  SynthControlChannelArtefact,
  SynthProducerControlBinding,
} from "./runtimeTypes";
import { controlChannelKey } from "./synthesisControlAbi";

export type SynthProducerMappingValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: string };

/** Build the block-rate mapping without changing compiler table order. */
export function buildSynthProducerControlBindings(
  controls: readonly SynthControlChannelArtefact[],
): SynthProducerControlBinding[] {
  const bindings: SynthProducerControlBinding[] = [];
  for (let compilerControlIndex = 0;
    compilerControlIndex < controls.length;
    compilerControlIndex += 1) {
    const control = controls[compilerControlIndex];
    if (control.rate !== "block") continue;
    bindings.push({
      identity: control.identity,
      param: control.param,
      channelKey: controlChannelKey(control.identity, control.param),
      compilerControlIndex,
    });
  }
  return bindings;
}

/**
 * Validate an untrusted structured-clone mapping before it can become live.
 * SAB order must be the compiler's relative order: indices are strictly
 * increasing, unique, in range, and tied to their collision-free key.
 */
export function validateSynthProducerControlBindings(
  compilerControlCount: number,
  bindings: readonly SynthProducerControlBinding[],
  maxBlockRateChannels: number,
): SynthProducerMappingValidation {
  if (!Number.isSafeInteger(compilerControlCount) || compilerControlCount < 0) {
    return { ok: false, reason: "compiler control count must be a non-negative safe integer" };
  }
  if (!Array.isArray(bindings)) {
    return { ok: false, reason: "control bindings must be an array" };
  }
  if (bindings.length > maxBlockRateChannels || bindings.length > compilerControlCount) {
    return { ok: false, reason: "control bindings exceed the declared compiler or SAB capacity" };
  }

  const keys = new Set<string>();
  let previousCompilerIndex = -1;
  for (const binding of bindings) {
    if (
      !binding ||
      typeof binding.identity !== "string" || binding.identity.length === 0 ||
      typeof binding.param !== "string" || binding.param.length === 0 ||
      typeof binding.channelKey !== "string" ||
      binding.channelKey !== controlChannelKey(binding.identity, binding.param)
    ) {
      return { ok: false, reason: "control binding identity, parameter, or key is invalid" };
    }
    if (
      !Number.isSafeInteger(binding.compilerControlIndex) ||
      binding.compilerControlIndex < 0 ||
      binding.compilerControlIndex >= compilerControlCount ||
      binding.compilerControlIndex <= previousCompilerIndex
    ) {
      return { ok: false, reason: "compiler control indices must be in-range and strictly increasing" };
    }
    if (keys.has(binding.channelKey)) {
      return { ok: false, reason: "producer control channel keys must be unique" };
    }
    keys.add(binding.channelKey);
    previousCompilerIndex = binding.compilerControlIndex;
  }
  return { ok: true };
}

/**
 * Prove that a mapping is the complete block-rate projection of the actual
 * compiler table, not merely a structurally plausible list of indices.
 */
export function validateSynthProducerControlBindingsAgainstControls(
  controls: readonly SynthControlChannelArtefact[],
  bindings: readonly SynthProducerControlBinding[],
  maxBlockRateChannels: number,
): SynthProducerMappingValidation {
  const structural = validateSynthProducerControlBindings(
    controls.length,
    bindings,
    maxBlockRateChannels,
  );
  if (!structural.ok) return structural;

  const expected = buildSynthProducerControlBindings(controls);
  if (expected.length !== bindings.length) {
    return { ok: false, reason: "control bindings are not the complete compiler block-rate projection" };
  }
  for (let index = 0; index < expected.length; index += 1) {
    const actual = bindings[index];
    const row = expected[index];
    if (
      actual.compilerControlIndex !== row.compilerControlIndex ||
      actual.identity !== row.identity ||
      actual.param !== row.param ||
      actual.channelKey !== row.channelKey
    ) {
      return { ok: false, reason: "control binding does not match the compiler table" };
    }
  }
  return { ok: true };
}
