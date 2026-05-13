// src/lib/gamepad/grabState.ts
//
// Module-level state for grab mode. Tracks whether grab is active and
// how many structural moves have been made (for batch-undo on cancel).
//
// This state lives outside of CodeMirror to avoid undo-redo complications.
// The visual indicator (polygon colour change) is driven by a separate
// CM StateField (grabModeField in stateField.ts) that syncs with this flag.

let _active = false;
let _moveCount = 0;
let _snapshotDoc: string | null = null;
let _snapshotCursorPaths: ReadonlyArray<ReadonlyArray<number>> | null = null;

export function startGrab(
  docText: string,
  cursorPaths: ReadonlyArray<ReadonlyArray<number>>,
): void {
  _active = true;
  _moveCount = 0;
  _snapshotDoc = docText;
  _snapshotCursorPaths = cursorPaths;
}

export function endGrab(): void {
  _active = false;
  _moveCount = 0;
  _snapshotDoc = null;
  _snapshotCursorPaths = null;
}

export function isGrabActive(): boolean {
  return _active;
}

export function recordGrabMove(): void {
  _moveCount++;
}

export function getGrabMoveCount(): number {
  return _moveCount;
}

export function getGrabSnapshot(): {
  doc: string;
  cursorPaths: ReadonlyArray<ReadonlyArray<number>>;
} | null {
  if (_snapshotDoc === null || _snapshotCursorPaths === null) return null;
  return { doc: _snapshotDoc, cursorPaths: _snapshotCursorPaths };
}
