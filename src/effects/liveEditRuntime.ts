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
import { isConnectedToModule, isJsonProtocolActive, sendSetLiveInputs } from "../transport/index.ts";

// ─── Singleton instances ────────────────────────────────────────────────────

export const liveEditStore: LiveEditStoreAPI = createLiveEditStore();
export const liveEditPersistence: LiveEditPersistence = createLiveEditPersistence();

const bridge: WidgetStoreBridge = createWidgetStoreBridge();
const storeValueHandler = createValueChangeHandler(liveEditStore);

// ─── Value change callback (widget → store → WASM) ──────────────────────────

// ─── Value conversion (§2.6 — boolean/keyword → double for WASM) ──────────

/**
 * Convert a slot value to the double representation expected by the WASM ABI.
 * - numeric: pass through
 * - boolean: true → 1, false → 0
 * - keyword: index into slot.options, or 0 if not found
 */
function slotValueToDouble(value: number | boolean | string, slot?: LiveEditSlot): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  // keyword → option index
  if (typeof value === "string" && slot?.options) {
    const idx = slot.options.indexOf(value);
    return idx >= 0 ? idx : 0;
  }
  return 0;
}

// ─── Per-tick batching and diff-encoding (§9.1–9.2) ────────────────────────

/** Default UI tick rate (Hz). Auto-throttled to 30 Hz when N>10 active. */
const DEFAULT_UI_TICK_HZ = 60;
const THROTTLE_THRESHOLD = 10;
const THROTTLED_UI_TICK_HZ = 30;

/** Pending values to send on the next UI tick. Keyed by slot id. */
const pendingWasmValues = new Map<string, number>();
const pendingHwValues = new Map<string, number | boolean | string>();

/** Last-sent table for diff-encoding — only send changed values. */
const lastSentWasm = new Map<string, number>();
const lastSentHw = new Map<string, number | boolean | string>();

let batchTickTimer: ReturnType<typeof setInterval> | null = null;
let currentTickHz = DEFAULT_UI_TICK_HZ;

function startBatchTicker(): void {
  if (batchTickTimer !== null) return;
  scheduleTicker();
}

function scheduleTicker(): void {
  const intervalMs = 1000 / currentTickHz;
  batchTickTimer = setInterval(flushBatchedValues, intervalMs);
}

function adjustTickRate(): void {
  const activeCount = pendingWasmValues.size;
  const targetHz = activeCount > THROTTLE_THRESHOLD
    ? THROTTLED_UI_TICK_HZ
    : DEFAULT_UI_TICK_HZ;

  if (targetHz !== currentTickHz) {
    currentTickHz = targetHz;
    if (batchTickTimer !== null) {
      clearInterval(batchTickTimer);
      batchTickTimer = null;
      scheduleTicker();
    }
  }
}

/**
 * Flush all pending value changes in a single batched call per runtime.
 * Uses diff-encoding: only sends values that changed since last send.
 */
function flushBatchedValues(): void {
  // ── WASM batch ──────────────────────────────────────────────────────
  if (pendingWasmValues.size > 0) {
    const wasmBatch: Record<string, number> = {};
    let wasmDirty = false;

    for (const [id, val] of pendingWasmValues) {
      const lastVal = lastSentWasm.get(id);
      if (lastVal === undefined || lastVal !== val) {
        wasmBatch[id] = val;
        lastSentWasm.set(id, val);
        wasmDirty = true;
      }
    }
    pendingWasmValues.clear();

    if (wasmDirty) {
      getActiveWasmRuntimePort().setLiveInputs(wasmBatch).catch(() => {
        // Silently ignore — runtime may not be loaded yet
      });
    }
  }

  // ── Hardware batch ──────────────────────────────────────────────────
  if (pendingHwValues.size > 0) {
    const hwBatch: Record<string, number | boolean | string> = {};
    let hwDirty = false;

    for (const [id, val] of pendingHwValues) {
      const lastVal = lastSentHw.get(id);
      if (lastVal === undefined || lastVal !== val) {
        hwBatch[id] = val;
        lastSentHw.set(id, val);
        hwDirty = true;
      }
    }
    pendingHwValues.clear();

    if (hwDirty && isConnectedToModule() && isJsonProtocolActive()) {
      sendSetLiveInputs(hwBatch).catch(() => {
        // Silently ignore — serial may have disconnected mid-send
      });
    }
  }
}

/**
 * Called by widget interactions. Updates the store AND queues the value
 * for batched dispatch to runtimes on the next UI tick.
 *
 * Spec: §6.5 wasm-preview state — slots allocated on WASM only (from a soft
 * eval) push values to WASM only; pre-existing hardware-registered slots push
 * to both runtimes.
 *
 * §9.1: Single batched useq_set_live_inputs per UI tick regardless of N.
 * §9.2: Diff-encoding — only send changed values via last-sent table.
 */
export function liveEditOnValueChange(slotId: string, value: number | boolean | string): void {
  // Update the store (sets modified flag, triggers reactive subscribers)
  storeValueHandler(slotId, value);

  // Persist debounced
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    liveEditPersistence.saveValue(slotId, value);
  }

  // Convert to double for WASM (§2.6: boolean → 0/1, keyword → option index)
  const slot = liveEditStore.getSlot(slotId);
  const wasmDouble = slotValueToDouble(value, slot);

  // Queue for batched WASM push
  pendingWasmValues.set(slotId, wasmDouble);

  // Queue for batched hardware push (§4.3: wasm-preview slots skip hardware)
  if (slot?.state !== "wasm-preview") {
    pendingHwValues.set(slotId, value);
  }

  // Adjust tick rate based on active knob count (§9.1)
  adjustTickRate();

  // Ensure the batch ticker is running
  startBatchTicker();
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

    // §2.6: Detect slot kind from WASM metadata variant field
    const kind: SlotKind = wasmSlot.variant === "boolean" ? "boolean"
      : wasmSlot.variant === "keyword" ? "keyword"
      : "numeric";

    // Determine the value: prefer store (user already interacted) > persisted > WASM seed.
    // For boolean slots, interpret double as boolean. For keyword slots, interpret
    // double as option index.
    let value: number | boolean | string;
    if (existingSlot && existingSlot.value !== undefined) {
      value = existingSlot.value;
    } else if (wasmSlot.id in persisted.values) {
      value = persisted.values[wasmSlot.id];
    } else if (kind === "boolean") {
      value = wasmSlot.seed !== 0;
    } else if (kind === "keyword" && wasmSlot.options && wasmSlot.options.length > 0) {
      const seedIdx = Math.round(wasmSlot.seed);
      value = wasmSlot.options[Math.min(seedIdx, wasmSlot.options.length - 1)] ?? wasmSlot.options[0];
    } else {
      value = wasmSlot.seed;
    }

    // Compute the seed in the appropriate type for the slot kind
    let seed: number | boolean | string;
    if (kind === "boolean") {
      seed = wasmSlot.seed !== 0;
    } else if (kind === "keyword" && wasmSlot.options && wasmSlot.options.length > 0) {
      const seedIdx = Math.round(wasmSlot.seed);
      seed = wasmSlot.options[Math.min(seedIdx, wasmSlot.options.length - 1)] ?? wasmSlot.options[0];
    } else {
      seed = wasmSlot.seed;
    }

    // Compute modified flag per §4.4
    let modified: boolean;
    if (typeof value === "number" && typeof seed === "number") {
      const step = wasmSlot.step ?? 0.01;
      modified = Math.abs(value - seed) > step / 2;
    } else {
      modified = value !== seed;
    }

    const slot: LiveEditSlot = {
      id: wasmSlot.id,
      kind,
      seed,
      value,
      min: wasmSlot.min,
      max: wasmSlot.max,
      step: wasmSlot.step,
      precision: wasmSlot.precision,
      options: wasmSlot.options,
      state: "idle",
      range,
      modified,
    };

    liveEditStore.registerSlot(slot);
  }

  // If any persisted values differ from seed, push them to both runtimes
  // so the store is in sync from frame 1.
  // §2.6: Convert boolean/keyword values to doubles for WASM.
  const currentValues = liveEditStore.getValuesRecord();
  const wasmDoubles: Record<string, number> = {};
  let hasValues = false;
  for (const [id, val] of Object.entries(currentValues)) {
    const storeSlot = liveEditStore.getSlot(id);
    wasmDoubles[id] = slotValueToDouble(val, storeSlot);
    hasValues = true;
  }
  if (hasValues) {
    // Push to WASM (all values as doubles)
    port.setLiveInputs(wasmDoubles).catch(() => {});

    // Push to hardware transport if connected (spec §7.3, §8.4)
    if (isConnectedToModule() && isJsonProtocolActive()) {
      const hwValues: Record<string, number | boolean | string> = {};
      for (const [id, val] of Object.entries(currentValues)) {
        hwValues[id] = val;
      }
      sendSetLiveInputs(hwValues).catch(() => {});
    }
  }

  // Clear wasm-preview state for all discovered slots after a normal eval
  // (spec §6.5: subsequent normal eval clears the wasm-preview badge).
  for (const wasmSlot of wasmSlots) {
    const existingSlot = liveEditStore.getSlot(wasmSlot.id);
    if (existingSlot?.state === "wasm-preview") {
      liveEditStore.setState(wasmSlot.id, "idle");
    }
  }

  // Trigger reconciliation after successful eval (§7.3 trigger 1).
  triggerReconciliation(view);
}

// ─── Reconciliation triggers (§7.3) ──────────────────────────────────────

/**
 * Extract live-edit IDs from the current document for reconciliation.
 */
function getDocumentLiveEditIds(view: EditorView): Set<string> {
  const docText = view.state.doc.toString();
  const ranges = scanDocumentForLiveEditRanges(docText);
  return new Set(ranges.keys());
}

/**
 * Run reconciliation against the current document (§7.3).
 * Moves orphaned values to the orphan table and restores cut-pasted ones.
 * Also cleans up the last-sent diff-encoding tables for removed slots.
 */
function triggerReconciliation(view: EditorView): void {
  const currentIds = getDocumentLiveEditIds(view);
  liveEditPersistence.reconcile(currentIds);

  // Clean up diff-encoding tables for slots no longer in the document
  for (const id of lastSentWasm.keys()) {
    if (!currentIds.has(id)) lastSentWasm.delete(id);
  }
  for (const id of lastSentHw.keys()) {
    if (!currentIds.has(id)) lastSentHw.delete(id);
  }
}

// ─── Document-change debounced reconciliation (§7.3 trigger 2) ──────────

let docChangeTimer: ReturnType<typeof setTimeout> | null = null;
const DOC_CHANGE_DEBOUNCE_MS = 500;

/**
 * Called on document changes. Debounces at ~500ms and runs reconciliation.
 * Covers the case where eval is failing repeatedly while the user edits
 * live-edit wrappers — persisted values still get cleaned up.
 */
export function onDocumentChange(view: EditorView): void {
  if (docChangeTimer !== null) {
    clearTimeout(docChangeTimer);
  }
  docChangeTimer = setTimeout(() => {
    docChangeTimer = null;
    triggerReconciliation(view);
  }, DOC_CHANGE_DEBOUNCE_MS);
}

// ─── Page lifecycle flush (§7.2) ────────────────────────────────────────

/**
 * Flush pending debounced values on page hide / visibility change.
 * Should be called once during app bootstrap to install the listeners.
 */
export function installPageLifecycleHandlers(): void {
  const flush = () => {
    const values = liveEditStore.getValuesRecord();
    const stringValues: Record<string, number | boolean | string> = {};
    for (const [id, val] of Object.entries(values)) {
      stringValues[id] = val;
    }
    liveEditPersistence.flushValues(stringValues);
  };

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });
  window.addEventListener("pagehide", flush);
}

// ─── Boot-time reconciliation (§7.3 trigger 3) ─────────────────────────

let bootReconciliationDone = false;

/**
 * Called after the first successful eval on page load. Restores persisted
 * values and reconciles against the document.
 *
 * If no eval fires within `idleEvalMs`, call this anyway to at least
 * reconcile orphans.
 */
export function runBootReconciliation(view: EditorView): void {
  if (bootReconciliationDone) return;
  bootReconciliationDone = true;
  triggerReconciliation(view);
}
