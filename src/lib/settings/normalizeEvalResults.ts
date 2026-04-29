/**
 * Eval Results Settings Normalization
 *
 * Validation and normalization for eval results display settings.
 */

import type { EvalResultsSettings } from "./schema.ts";
import { defaultUserSettings } from "./schema.ts";
import { isRecord, coerceNumber } from "./normalizationHelpers.ts";

const VALID_EVAL_MODES: ReadonlySet<string> = new Set([
  "console",
  "inline",
  "inline-ephemeral",
  "floating",
]);

export function normalizeEvalResultsSettings(
  value: unknown,
  defaults: EvalResultsSettings = defaultUserSettings.evalResults,
): EvalResultsSettings {
  const raw = isRecord(value) ? value : {};
  const mode =
    typeof raw.mode === "string" && VALID_EVAL_MODES.has(raw.mode)
      ? (raw.mode as EvalResultsSettings["mode"])
      : defaults.mode;
  return {
    mode,
    autoDismissMs: coerceNumber(raw.autoDismissMs, defaults.autoDismissMs),
    maxChars: coerceNumber(raw.maxChars, defaults.maxChars),
    showTimestamp:
      raw.showTimestamp == null ? defaults.showTimestamp : raw.showTimestamp !== false,
  };
}
