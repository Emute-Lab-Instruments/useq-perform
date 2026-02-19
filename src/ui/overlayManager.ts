/**
 * overlayManager — centralized overlay stack for escape handling and scroll lock.
 *
 * API:
 *   pushOverlay(id, onEscape) → popFn
 *     Registers an overlay at the top of the stack.
 *     Returns a function that removes this overlay from the stack.
 *
 * Scroll lock:
 *   Reference-counted. body overflow is set to "hidden" when the first overlay
 *   is pushed and restored when the last overlay is popped. Individual components
 *   must NOT set document.body.style.overflow themselves.
 *
 * Escape handling:
 *   A single document-level "keydown" listener dispatches Escape to the
 *   topmost overlay only (LIFO order).
 */

type OverlayEntry = {
  id: string;
  onEscape: () => void;
};

const stack: OverlayEntry[] = [];
let scrollLockCount = 0;
let savedOverflow = "";

function applyScrollLock(): void {
  if (scrollLockCount === 0) {
    savedOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  scrollLockCount++;
}

function releaseScrollLock(): void {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = savedOverflow;
    savedOverflow = "";
  }
}

function handleKeyDown(e: KeyboardEvent): void {
  if (e.key !== "Escape") return;
  const top = stack[stack.length - 1];
  if (top) {
    top.onEscape();
  }
}

function ensureListener(): void {
  if (stack.length === 1) {
    // First overlay: attach the shared listener
    document.addEventListener("keydown", handleKeyDown);
  }
}

function maybeRemoveListener(): void {
  if (stack.length === 0) {
    document.removeEventListener("keydown", handleKeyDown);
  }
}

/**
 * Push an overlay onto the stack.
 *
 * @param id       Identifier for debugging / deduplication (not enforced).
 * @param onEscape Called when Escape is pressed and this overlay is topmost.
 * @returns        A function that pops this overlay from the stack.
 */
export function pushOverlay(id: string, onEscape: () => void): () => void {
  const entry: OverlayEntry = { id, onEscape };
  stack.push(entry);
  applyScrollLock();
  ensureListener();

  return function popOverlay(): void {
    const idx = stack.lastIndexOf(entry);
    if (idx !== -1) {
      stack.splice(idx, 1);
      releaseScrollLock();
      maybeRemoveListener();
    }
  };
}

/** Exposed for testing only — resets all internal state. */
export function _resetForTesting(): void {
  stack.length = 0;
  scrollLockCount = 0;
  savedOverflow = "";
  document.removeEventListener("keydown", handleKeyDown);
  document.body.style.overflow = "";
}

/** Exposed for testing — returns the current stack depth. */
export function _stackDepth(): number {
  return stack.length;
}
