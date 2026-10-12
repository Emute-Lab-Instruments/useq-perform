/** Test setup uses the same prepared graph protocol as synthesisService. */
import type { WorkletCore } from "../workletCore";
import type { WorkletPrepareGraphMessage } from "../workletGraphDelta";

let nextTransactionId = 100_000;

export function commitGraph(core: WorkletCore, deltas: WorkletPrepareGraphMessage["deltas"], epoch = deltas[0].identity.epoch): void {
  const transactionId = nextTransactionId++;
  core.handleMessage({ type: "prepare-graph", transactionId, epoch, deltas });
  core.handleMessage({ type: "commit-graph", transactionId });
  core.handleMessage({ type: "activate-graph", transactionId });
}
