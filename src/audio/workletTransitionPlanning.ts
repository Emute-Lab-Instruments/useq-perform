/** Pure transition planning for the mutable AudioWorklet core. */

export interface WorkletGraphEdge {
  readonly source: number;
  readonly target: number;
}

export interface WorkletGraphPlan {
  readonly order: readonly number[];
  readonly consumed: readonly boolean[];
}

/**
 * Build a stable topological order and terminal-node mask.
 *
 * This runs only in the between-quanta graph mutation path. Cycles retain
 * insertion order after every acyclic node, matching the worklet's bounded
 * one-block-feedback fallback.
 */
export function planWorkletGraph(
  nodeCount: number,
  edges: readonly WorkletGraphEdge[],
): WorkletGraphPlan {
  const indegree = new Array<number>(nodeCount).fill(0);
  const adjacency: number[][] = Array.from({ length: nodeCount }, () => []);
  const consumed = new Array<boolean>(nodeCount).fill(false);

  for (const edge of edges) {
    if (
      edge.source < 0 || edge.source >= nodeCount ||
      edge.target < 0 || edge.target >= nodeCount ||
      edge.source === edge.target
    ) {
      continue;
    }
    adjacency[edge.source].push(edge.target);
    indegree[edge.target] += 1;
    consumed[edge.source] = true;
  }

  const ready: number[] = [];
  for (let index = 0; index < nodeCount; index += 1) {
    if (indegree[index] === 0) ready.push(index);
  }

  const order: number[] = [];
  const visited = new Array<boolean>(nodeCount).fill(false);
  let readyPosition = 0;
  while (readyPosition < ready.length) {
    const index = ready[readyPosition++];
    visited[index] = true;
    order.push(index);
    for (const target of adjacency[index]) {
      indegree[target] -= 1;
      if (indegree[target] === 0) ready.push(target);
    }
  }
  for (let index = 0; index < nodeCount; index += 1) {
    if (!visited[index]) order.push(index);
  }
  return { order, consumed };
}

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
