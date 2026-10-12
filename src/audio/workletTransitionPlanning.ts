/** Pure producer-liveness planning for the AudioWorklet core. */

export const PRODUCER_LIVENESS_HOLD = 0 as const;
export const PRODUCER_LIVENESS_RESET = 1 as const;
export const PRODUCER_LIVENESS_ADVANCE = 2 as const;
export const PRODUCER_LIVENESS_ADVANCE_UNDERRUN = 3 as const;

export type ProducerLivenessAction =
  | typeof PRODUCER_LIVENESS_HOLD
  | typeof PRODUCER_LIVENESS_RESET
  | typeof PRODUCER_LIVENESS_ADVANCE
  | typeof PRODUCER_LIVENESS_ADVANCE_UNDERRUN;

/**
 * Plan one render quantum's producer-liveness update.
 *
 * Primitive arguments and a numeric return keep this callable from the
 * allocation-free render path without creating a per-block result object.
 */
export function planProducerLiveness(
  controlAttached: boolean,
  acquiredBlock: boolean,
  producerEverPublished: boolean,
  controlEverAttached: boolean,
): ProducerLivenessAction {
  if (acquiredBlock) return PRODUCER_LIVENESS_RESET;
  if (controlAttached) {
    return producerEverPublished
      ? PRODUCER_LIVENESS_ADVANCE_UNDERRUN
      : PRODUCER_LIVENESS_HOLD;
  }
  return controlEverAttached
    ? PRODUCER_LIVENESS_ADVANCE
    : PRODUCER_LIVENESS_HOLD;
}

export function shouldEnterProducerTimeout(
  timeoutActive: boolean,
  livenessAge: number,
  timeoutBlocks: number,
  producerTerminated: boolean,
): boolean {
  return !timeoutActive &&
    (livenessAge >= timeoutBlocks || producerTerminated);
}
