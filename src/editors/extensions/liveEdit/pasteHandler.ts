/**
 * Copy-paste duplicate :id rewriting — §3.9.
 *
 * When a paste introduces a `(live-edit ...)` wrapper whose `:id` already
 * exists elsewhere in the document, the pasted wrapper is rewritten to a
 * fresh `:id` in the same paste transaction.
 *
 * The persisted value of the original is NOT inherited — different id,
 * different slot, both initialise to `<seed>`.
 *
 * Also observes document changes more generally to catch any source of
 * duplicate IDs (e.g., external editor paste, programmatic mutations).
 */

import { ViewPlugin } from "@codemirror/view";
import type { ViewUpdate } from "@codemirror/view";
import { type ChangeSpec, Transaction } from "@codemirror/state";

import { generateId } from "./markAction.ts";

// ── Regex for scanning live-edit wrappers ─────────────────────────────────

const LIVE_EDIT_OPEN = /\(live-edit\s/g;
const ID_PATTERN = /:id\s+"([^"]+)"/;

/**
 * Find the matching close-paren for a `(live-edit ...` starting at `from`
 * in the document text. Returns the exclusive end position (after the `)`)
 * or -1 if unbalanced.
 */
function findMatchingParen(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") { i++; continue; }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') { inString = true; continue; }
    if (ch === "(") depth++;
    if (ch === ")") {
      depth--;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

/**
 * Scan text for all `(live-edit ...)` wrapper IDs. Returns a map from
 * ID string → array of occurrences (as {from, to, idFrom, idTo} offsets
 * relative to the start of `text`).
 */
interface LiveEditOccurrence {
  /** Offset of the :id "..." value start (the opening quote) */
  idValueFrom: number;
  /** Offset of the :id "..." value end (after closing quote) */
  idValueTo: number;
}

function scanForLiveEditIds(
  text: string,
): Map<string, LiveEditOccurrence[]> {
  const idOccurrences = new Map<string, LiveEditOccurrence[]>();
  LIVE_EDIT_OPEN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LIVE_EDIT_OPEN.exec(text)) !== null) {
    const from = match.index;
    const to = findMatchingParen(text, from);
    if (to === -1) continue;

    const wrapperText = text.slice(from, to);
    const idMatch = ID_PATTERN.exec(wrapperText);
    if (idMatch && idMatch[1]) {
      const id = idMatch[1];
      // Find the position of the :id "..." within the full text
      const idOffset = wrapperText.indexOf(`:id "${id}"`);
      if (idOffset !== -1) {
        // The "..." portion including quotes
        const idStringStart = from + idOffset + 5; // `:id ` = 4 + quote = 5
        const idStringEnd = idStringStart + id.length; // just the ID chars (between quotes)
        const list = idOccurrences.get(id) ?? [];
        list.push({
          idValueFrom: idStringStart,
          idValueTo: idStringEnd,
        });
        idOccurrences.set(id, list);
      }
    }
  }

  return idOccurrences;
}

// ── ViewPlugin ────────────────────────────────────────────────────────────

/**
 * ViewPlugin that watches for document changes and rewrites duplicate
 * live-edit :id values to fresh unique IDs.
 *
 * Runs after the paste/edit has been applied to the document. If duplicate
 * IDs are found, dispatches a follow-up transaction that rewrites the
 * duplicate occurrences to fresh IDs.
 */
export const liveEditPasteHandler = ViewPlugin.fromClass(
  class {
    update(u: ViewUpdate): void {
      if (!u.docChanged) return;

      const isPasteOrInput = u.transactions.some(
        (tr) =>
          tr.isUserEvent("input.paste") ||
          tr.isUserEvent("liveEdit.mark") ||
          tr.isUserEvent("liveEdit.vectorMark"),
      );

      // Skip our own rewrite transactions
      const isRewrite = u.transactions.some(
        (tr) => tr.isUserEvent("liveEdit.pasteRewrite"),
      );
      if (isRewrite) return;

      // Only check on paste events or general input that might introduce duplicates
      if (!isPasteOrInput) return;

      // Defer to a microtask to avoid dispatching inside update
      const view = u.view;
      queueMicrotask(() => {
        const docText = view.state.doc.toString();
        const idMap = scanForLiveEditIds(docText);

        // Find IDs with more than one occurrence
        const existingIds = new Set<string>();
        for (const id of idMap.keys()) {
          existingIds.add(id);
        }

        const changes: ChangeSpec[] = [];

        for (const [id, occurrences] of idMap) {
          if (occurrences.length <= 1) continue;

          // Keep the first occurrence, rewrite subsequent ones
          for (let i = 1; i < occurrences.length; i++) {
            const occ = occurrences[i];
            const freshId = generateId(existingIds);
            existingIds.add(freshId);

            changes.push({
              from: occ.idValueFrom,
              to: occ.idValueTo,
              insert: freshId,
            });
          }
        }

        if (changes.length > 0) {
          view.dispatch({
            changes,
            annotations: [Transaction.addToHistory.of(false)],
            userEvent: "liveEdit.pasteRewrite",
          });
        }
      });
    }
  },
);
