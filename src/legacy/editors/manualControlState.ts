// Shared manual-control state.
//
// Kept in a dedicated module to avoid circular imports between gamepad control
// and editor evaluation/sending.

import type { ChangeDesc } from "@codemirror/state";

type StickSide = 'left' | 'right';

export interface ManualControlBinding {
  stick: StickSide;
  slot: number;
  from: number;
  to: number;
  value: number;
  originalText: string;
  lastSentAt: number;
  lastSentValue: number;
}

const bindingsByStick: Record<StickSide, ManualControlBinding | null> = {
  left: null,
  right: null,
};

export function slotForStick(stick: StickSide): number {
  return stick === 'right' ? 17 : 1;
}

export function getManualControlBinding(stick: StickSide): ManualControlBinding | null {
  return bindingsByStick[stick] || null;
}

export function setManualControlBinding(stick: StickSide, binding: ManualControlBinding | null): void {
  bindingsByStick[stick] = binding || null;
}

export function clearManualControlBinding(stick: StickSide): void {
  bindingsByStick[stick] = null;
}

export function getAllManualControlBindings(): ManualControlBinding[] {
  return Object.values(bindingsByStick).filter(Boolean) as ManualControlBinding[];
}

/**
 * Map all active bindings through a CodeMirror ChangeSet/ChangeDesc.
 * This keeps `{from,to}` stable when the document is edited (typing, paste, etc).
 */
export function mapManualControlBindingsThroughChanges(changes: ChangeDesc | null | undefined): void {
  if (!changes || typeof changes.mapPos !== "function") return;

  for (const stick of (["left", "right"] as const)) {
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
 */
export function rewriteCodeSliceForModule(codeSlice: string, baseFrom: number, baseTo: number): string {
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
