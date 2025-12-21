// Shared manual-control state.
//
// Kept in a dedicated module to avoid circular imports between gamepad control
// and editor evaluation/sending.

const bindingsByStick = {
  left: null,
  right: null,
};

export function slotForStick(stick) {
  return stick === 'right' ? 17 : 1;
}

export function getManualControlBinding(stick) {
  return bindingsByStick[stick] || null;
}

export function setManualControlBinding(stick, binding) {
  bindingsByStick[stick] = binding || null;
}

export function clearManualControlBinding(stick) {
  bindingsByStick[stick] = null;
}

export function getAllManualControlBindings() {
  return Object.values(bindingsByStick).filter(Boolean);
}

/**
 * Map all active bindings through a CodeMirror ChangeSet/ChangeDesc.
 * This keeps `{from,to}` stable when the document is edited (typing, paste, etc).
 *
 * @param {import("@codemirror/state").ChangeDesc | import("@codemirror/state").ChangeSet} changes
 */
export function mapManualControlBindingsThroughChanges(changes) {
  if (!changes || typeof changes.mapPos !== "function") return;

  for (const stick of /** @type {const} */ (["left", "right"])) {
    const binding = bindingsByStick[stick];
    if (!binding) continue;
    if (typeof binding.from !== "number" || typeof binding.to !== "number") continue;

    const mappedFrom = changes.mapPos(binding.from, 1);
    const mappedTo = changes.mapPos(binding.to, -1);

    if (typeof mappedFrom === "number" && typeof mappedTo === "number" && mappedTo >= mappedFrom) {
      binding.from = mappedFrom;
      binding.to = mappedTo;
    }
  }
}

/**
 * Rewrite a code slice by substituting bound ranges with `(ssin N)`.
 *
 * @param {string} codeSlice code exactly equal to state.doc.sliceString(baseFrom, baseTo)
 * @param {number} baseFrom absolute document position of the slice start
 * @param {number} baseTo absolute document position of the slice end
 */
export function rewriteCodeSliceForModule(codeSlice, baseFrom, baseTo) {
  const bindings = getAllManualControlBindings();
  if (!bindings.length) return codeSlice;

  const applicable = bindings
    .filter((b) => typeof b?.from === 'number' && typeof b?.to === 'number')
    .filter((b) => b.from >= baseFrom && b.to <= baseTo)
    .sort((a, b) => b.from - a.from);

  if (!applicable.length) return codeSlice;

  let rewritten = codeSlice;
  for (const binding of applicable) {
    const relFrom = binding.from - baseFrom;
    const relTo = binding.to - baseFrom;
    if (relFrom < 0 || relTo > rewritten.length || relTo <= relFrom) continue;
    const replacement = `(ssin ${binding.slot})`;
    rewritten = rewritten.slice(0, relFrom) + replacement + rewritten.slice(relTo);
  }

  return rewritten;
}


