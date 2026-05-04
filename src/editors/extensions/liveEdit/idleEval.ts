/**
 * Auto-eval on idle for live-edit allocation changes — §6.6.
 *
 * After a structural change that affects live-edit allocation
 * (mark/unmark/commit/editRange/copy-paste), if no explicit eval has been
 * triggered within `liveEdit.idleEvalMs` (default 1500 ms), the editor
 * auto-evals the affected top-level form to register the slot(s).
 *
 * This drives `uninitialised` widgets to `idle` and ensures persisted
 * values flush to the runtime.
 *
 * Suppressible via setting `liveEdit.autoEvalOnIdle = false`.
 *
 * Spec: docs/specs/live-edit.md §6.6, §10.7, §10.8
 */

import { ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";

import { evaluate } from "../../../effects/editorEvaluation.ts";

// ── Constants (defaults from §10.7, §10.8) ──────────────────────────────

const DEFAULT_IDLE_EVAL_MS = 1500;

// ── ViewPlugin ─────────────────────────────────────────────────────���────

/**
 * ViewPlugin that watches for document changes from live-edit actions
 * and triggers an auto-eval after an idle period if no explicit eval
 * has occurred.
 *
 * Watches for these userEvent annotations:
 *   - liveEdit.mark / liveEdit.vectorMark / liveEdit.unmark
 *   - liveEdit.commit
 *   - liveEdit.editRange
 *   - liveEdit.pasteRewrite
 *   - input.paste (might introduce live-edit wrappers)
 */
export function createIdleEvalPlugin(options?: {
  idleEvalMs?: number;
  autoEvalOnIdle?: boolean;
}) {
  const idleMs = options?.idleEvalMs ?? DEFAULT_IDLE_EVAL_MS;
  const enabled = options?.autoEvalOnIdle ?? true;

  if (!enabled || idleMs <= 0) {
    // Return a no-op plugin if disabled
    return ViewPlugin.fromClass(class {
      update(_u: ViewUpdate): void { /* no-op */ }
    });
  }

  return ViewPlugin.fromClass(
    class {
      private timer: ReturnType<typeof setTimeout> | null = null;
      private view: import("@codemirror/view").EditorView;

      constructor(view: import("@codemirror/view").EditorView) {
        this.view = view;
      }

      update(u: ViewUpdate): void {
        if (!u.docChanged) return;

        // Check if this change is from a live-edit structural action
        const isLiveEditChange = u.transactions.some((tr) =>
          tr.isUserEvent("liveEdit.mark") ||
          tr.isUserEvent("liveEdit.vectorMark") ||
          tr.isUserEvent("liveEdit.unmark") ||
          tr.isUserEvent("liveEdit.commit") ||
          tr.isUserEvent("liveEdit.editRange") ||
          tr.isUserEvent("liveEdit.pasteRewrite"),
        );

        // Also check for paste events that might introduce wrappers
        const isPaste = u.transactions.some((tr) =>
          tr.isUserEvent("input.paste"),
        );

        // Check if an explicit eval was already triggered (via the eval
        // user event that editorEvaluation.ts emits)
        const hasEval = u.transactions.some((tr) =>
          tr.isUserEvent("eval"),
        );

        if (hasEval) {
          // Eval already happened — cancel any pending idle timer
          this.cancelTimer();
          return;
        }

        if (!isLiveEditChange && !isPaste) return;

        // Reset the idle timer
        this.cancelTimer();
        this.timer = setTimeout(() => {
          this.timer = null;
          // Auto-eval the toplevel form to register slots
          evaluate(this.view, "toplevel");
        }, idleMs);
      }

      destroy(): void {
        this.cancelTimer();
      }

      private cancelTimer(): void {
        if (this.timer !== null) {
          clearTimeout(this.timer);
          this.timer = null;
        }
      }
    },
  );
}
