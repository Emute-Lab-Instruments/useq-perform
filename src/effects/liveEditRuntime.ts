/**
 * Live-edit runtime wiring — singleton module.
 *
 * Instantiates the live-edit store, persistence, and widget store bridge.
 * Provides:
 *   - `liveEditStore` — the singleton store instance
 *   - `liveEditPersistence` — the singleton persistence instance
 *   - `liveEditOnValueChange` — callback for widget interactions that
 *     updates the store AND pushes to the WASM runtime via setLiveInputs
 *   - `discoverSlotsAfterEval(view)` — called after successful eval to
 *     discover allocated slots from WASM and register/sync them in the store
 *   - `attachBridgeToEditor(view)` — attaches the store→widget bridge to the
 *     editor view (call once after editor creation)
 *
 * Spec: docs/specs/live-edit.md §1.4, §3.2 step 4, §4
 */

import { createLiveEditStore, type LiveEditStoreAPI } from "./liveEditStore.ts";
import { createLiveEditPersistence, type LiveEditPersistence } from "./liveEditPersistence.ts";
import {
  createWidgetStoreBridge,
  createValueChangeHandler,
  type WidgetStoreBridge,
} from "../editors/extensions/liveEdit/widgetStoreBridge.ts";
import type { EditorView } from "@codemirror/view";
import type { LiveEditSlot, SlotKind } from "../contracts/liveEdit.ts";
import type { LiveSlotMetadata } from "../contracts/runtimePorts.ts";
import { getActiveWasmRuntimePort } from "../runtime/activeWasmRuntimePort.ts";

// ─── Singleton instances ────────────────────────────────────────────────────

export const liveEditStore: LiveEditStoreAPI = createLiveEditStore();
export const liveEditPersistence: LiveEditPersistence = createLiveEditPersistence();

const bridge: WidgetStoreBridge = createWidgetStoreBridge();
const storeValueHandler = createValueChangeHandler(liveEditStore);

// ─── Value change callback (widget → store → WASM) ──────────────────────────

/**
 * Called by widget interactions. Updates the store AND pushes the new value
 * to the WASM runtime so the interpreter sees the change on the next tick.
 */
export function liveEditOnValueChange(slotId: string, value: number | boolean | string): void {
  // Update the store (sets modified flag, triggers reactive subscribers)
  storeValueHandler(slotId, value);

  // Persist debounced
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    liveEditPersistence.saveValue(slotId, value);
  }

  // Push to WASM runtime — only numeric values are supported by the ABI
  if (typeof value === "number") {
    const values: Record<string, number> = { [slotId]: value };
    getActiveWasmRuntimePort().setLiveInputs(values).catch(() => {
      // Silently ignore — runtime may not be loaded yet
    });
  }
}

// ─── Bridge attachment ──────────────────────────────────────────────────────

/**
 * Attach the store→widget bridge to the editor view. Call once after the
 * main editor is created. Subsequent calls re-attach (implicitly detaches
 * the previous binding).
 *
 * Guards against non-EditorView objects (e.g. in test mocks) by checking
 * for the `dispatch` method before attaching.
 */
export function attachBridgeToEditor(view: EditorView): void {
  if (!view || typeof view.dispatch !== "function") return;
  bridge.attach(view, liveEditStore);
}

// ─── Slot discovery after eval ──────────────────────────────────────────────

/**
 * Regex that matches `(live-edit` at the start of a list form and captures
 * its full extent (for finding the wrapper's document range).
 *
 * Strategy: find each `(live-edit ` occurrence, then parse forward to find
 * the matching close paren by counting nesting depth.
 */
const LIVE_EDIT_OPEN = /\(live-edit\s/g;

/**
 * Extract the `:id` value from a `(live-edit ...)` substring.
 * Expects `:id "..."` or `:id "<value>"` somewhere inside the form.
 */
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
 * Scan the document text for all `(live-edit ...)` wrappers and return
 * a map from slot id → document range.
 */
function scanDocumentForLiveEditRanges(
  docText: string,
): Map<string, { from: number; to: number }> {
  const ranges = new Map<string, { from: number; to: number }>();
  LIVE_EDIT_OPEN.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = LIVE_EDIT_OPEN.exec(docText)) !== null) {
    const from = match.index;
    const to = findMatchingParen(docText, from);
    if (to === -1) continue;

    const wrapperText = docText.slice(from, to);
    const idMatch = ID_PATTERN.exec(wrapperText);
    if (idMatch && idMatch[1]) {
      ranges.set(idMatch[1], { from, to });
    }
  }

  return ranges;
}

/**
 * After a successful eval, discover allocated slots from the WASM runtime
 * and synchronize the live-edit store.
 *
 * Flow:
 * 1. Call `getLiveSlots()` on the WASM port to get allocated slot metadata.
 * 2. Scan the document for `(live-edit ...)` wrapper ranges.
 * 3. For each slot that has both WASM metadata and a document range,
 *    register/update it in the store.
 * 4. Load persisted values for known slots (restoring on reload).
 */
export async function discoverSlotsAfterEval(view: EditorView): Promise<void> {
  const port = getActiveWasmRuntimePort();
  const caps = port.capabilities();
  if (!caps.supportsLiveInputs) return;

  let wasmSlots: LiveSlotMetadata[];
  try {
    wasmSlots = await port.getLiveSlots();
  } catch {
    return;
  }

  if (wasmSlots.length === 0) {
    // No slots allocated — if the store has slots, leave them as-is
    // (they might be uninitialised from a previous doc state).
    return;
  }

  // Scan the document for wrapper ranges
  const docText = view.state.doc.toString();
  const docRanges = scanDocumentForLiveEditRanges(docText);

  // Load persisted values for restoration
  const persisted = liveEditPersistence.load();

  // Build or update slots in the store
  for (const wasmSlot of wasmSlots) {
    const range = docRanges.get(wasmSlot.id);
    if (!range) continue; // Slot exists in WASM but not in current doc — skip

    const existingSlot = liveEditStore.getSlot(wasmSlot.id);

    // Determine the value: prefer store (user already interacted) > persisted > WASM seed
    let value: number;
    if (existingSlot && typeof existingSlot.value === "number") {
      value = existingSlot.value;
    } else if (wasmSlot.id in persisted.values && typeof persisted.values[wasmSlot.id] === "number") {
      value = persisted.values[wasmSlot.id] as number;
    } else {
      value = wasmSlot.seed;
    }

    const kind: SlotKind = "numeric"; // WASM slots are always numeric for now
    const slot: LiveEditSlot = {
      id: wasmSlot.id,
      kind,
      seed: wasmSlot.seed,
      value,
      min: wasmSlot.min,
      max: wasmSlot.max,
      state: "idle",
      range,
      modified: Math.abs(value - wasmSlot.seed) > 0.005,
    };

    liveEditStore.registerSlot(slot);
  }

  // If any persisted values differ from seed, push them to WASM so the
  // runtime is in sync with the store from frame 1.
  const currentValues = liveEditStore.getValuesRecord();
  const numericValues: Record<string, number> = {};
  let hasValues = false;
  for (const [id, val] of Object.entries(currentValues)) {
    if (typeof val === "number") {
      numericValues[id] = val;
      hasValues = true;
    }
  }
  if (hasValues) {
    port.setLiveInputs(numericValues).catch(() => {});
  }
}
