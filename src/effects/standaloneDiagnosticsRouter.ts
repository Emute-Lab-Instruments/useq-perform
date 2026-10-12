/**
 * Standalone diagnostics router (wire-protocol §5.9).
 *
 * The firmware may emit an unsolicited `diagnostics` frame (device → editor)
 * that is NOT a response to an eval. `json-protocol.ts` parses those frames and
 * republishes them on `standaloneDiagnostics`. This effect subscribes to that
 * channel and routes the diagnostics into the editor's inline annotation
 * pipeline via `pushDiagnostics`, mirroring the eval-response path in
 * `editorEvaluation.ts`.
 *
 * Standalone spans are document-relative. They are additive because the frame
 * is not tied to an eval range and must not clear diagnostics from prior evals.
 */
import { standaloneDiagnostics } from "../contracts/runtimeChannels.ts";
import type { UseqDiagnostic } from "../contracts/runtimeTypes.ts";
import type { EditorView } from "@codemirror/view";

export interface StandaloneDiagnosticsRouterDependencies {
  getEditor(): EditorView | null;
  pushDiagnostics(
    view: EditorView,
    diagnostics: UseqDiagnostic[],
    docOffset?: number,
    rangeFrom?: number,
    rangeTo?: number,
    clearRange?: boolean,
  ): void;
}

let unsubscribe: (() => void) | null = null;

/**
 * Subscribe the standalone-diagnostics channel to the editor's inline
 * diagnostics pipeline. Idempotent — calling twice is a no-op.
 */
export function initStandaloneDiagnosticsRouter(
  dependencies: StandaloneDiagnosticsRouterDependencies,
): void {
  if (unsubscribe) return;
  unsubscribe = standaloneDiagnostics.subscribe((detail) => {
    const view = dependencies.getEditor();
    if (!view) return;
    if (!detail.diagnostics.length) return;
    // Unsolicited diagnostics are not tied to an eval range. Preserve existing
    // eval diagnostics and treat firmware spans as document coordinates.
    dependencies.pushDiagnostics(view, detail.diagnostics, 0, 0, 0, false);
  });
}

/** Tear down the subscription (used by tests / app shutdown). */
export function teardownStandaloneDiagnosticsRouter(): void {
  unsubscribe?.();
  unsubscribe = null;
}
