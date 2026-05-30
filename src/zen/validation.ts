import type { EditorView } from "@codemirror/view";
import type { Exercise } from "./exercises";

export interface ValidationResult {
  /** Whitespace-insensitive equality between the editor text and the target. */
  codeMatch: boolean;
  cursorMatch: boolean;
  complete: boolean;
}

export function validateExercise(
  view: EditorView,
  exercise: Exercise,
): ValidationResult {
  const currentCode = view.state.doc.toString();
  const codeMatch = normalizeCode(currentCode) === normalizeCode(exercise.targetCode);

  // For navigation exercises (code doesn't change), validate cursor position
  // For mutation exercises, cursor check is lenient — just need the code right
  const codeChanges = normalizeCode(exercise.startCode) !== normalizeCode(exercise.targetCode);
  const cursorMatch = codeChanges
    ? codeMatch // if code changed and matches, cursor is "close enough"
    : checkCursorPosition(view, exercise.targetCursorText);

  const complete = codeMatch && cursorMatch;
  return { codeMatch, cursorMatch, complete };
}

// Whitespace-insensitive comparison: collapse runs of whitespace to a single
// space and trim. This is intentionally a normalised *string* comparison rather
// than a structural tree-walk — for the current exercise set (whose start/target
// differ only by structural-editing rearrangements) the two are equivalent, and
// it avoids coupling zen validation to the structural parser. Tree-aware
// comparison (ignoring comments, comparing node kinds) is a future refinement.
function normalizeCode(code: string): string {
  return code.replace(/\s+/g, " ").trim();
}

function checkCursorPosition(view: EditorView, targetText: string): boolean {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc.toString();

  // Check 1: selected text matches target exactly
  const selectedText = doc.slice(from, to);
  if (selectedText === targetText) return true;

  // Check 2: cursor (collapsed or not) is positioned within the target text range
  const targetStart = doc.indexOf(targetText);
  if (targetStart === -1) return false;
  const targetEnd = targetStart + targetText.length;

  // Cursor from is within target range
  if (from >= targetStart && from <= targetEnd) return true;

  // Selection overlaps target range
  if (from <= targetStart && to >= targetEnd) return true;

  return false;
}
