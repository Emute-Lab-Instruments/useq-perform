// Default EvalIntegrationConfig wiring — imports from transport layer.
// This file exists so that expressionEval.ts itself has zero transport imports,
// making it loadable in isolation (Inspector, tests) with a mock config.

import { sendTouSEQ } from "../../transport/json-protocol.ts";
import { isConnectedToModule } from "../../transport/connector.ts";
import type { EvalIntegrationConfig } from "./expressionEval.ts";

/** Create an EvalIntegrationConfig that delegates to the real transport singletons. */
export function createDefaultEvalIntegrationConfig(): EvalIntegrationConfig {
  return {
    sendCode: (code: string) => sendTouSEQ(code),
    isConnected: () => isConnectedToModule(),
  };
}
