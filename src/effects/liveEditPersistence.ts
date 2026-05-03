/**
 * Persistence module for live-edit slot values, orphan tracking, MIDI
 * bindings, and panel state.
 *
 * Spec: docs/specs/live-edit.md §7
 *
 * Storage key: uSEQ-Perform-Editor-LiveEdits
 *
 * Debouncing: slot values are debounced at 200ms. MIDI bindings and panel
 * state are written immediately.
 */

import { load, save, PERSISTENCE_KEYS } from "../lib/persistence.ts";
import type { LiveEditPanelOrder } from "../contracts/liveEdit.ts";
import type { MidiSource } from "../contracts/midi.ts";

// ---------------------------------------------------------------------------
// Persisted shape (§7)
// ---------------------------------------------------------------------------

export interface LiveEditPersistedData {
  values: Record<string, number | boolean | string>;
  orphans: Record<
    string,
    { value: number | boolean | string; orphanedAt: number }
  >;
  midiBindings: Record<string, MidiSource>;
  panelOrder: { mode: "document" | "custom"; custom?: Record<string, string[]> };
  panelDock: "right" | "bottom" | "left";
  panelOpen: boolean;
  schemaVersion: 1;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_DATA: LiveEditPersistedData = {
  values: {},
  orphans: {},
  midiBindings: {},
  panelOrder: { mode: "document" },
  panelDock: "right",
  panelOpen: false,
  schemaVersion: 1,
};

const DEFAULT_ORPHAN_GC_HOURS = 24;
const DEBOUNCE_MS = 200;

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface LiveEditPersistence {
  /** Load persisted data at boot. Returns the stored data or defaults. */
  load(): LiveEditPersistedData;

  /** Save a slot value (debounced 200ms). */
  saveValue(id: string, value: number | boolean | string): void;

  /** Save all current values immediately (e.g., on page hide). */
  flushValues(values: Record<string, number | boolean | string>): void;

  /** Save a MIDI binding (immediate). */
  saveBinding(slotId: string, source: MidiSource): void;

  /** Remove a MIDI binding (immediate). */
  removeBinding(slotId: string): void;

  /** Save panel state (immediate). */
  savePanelState(state: {
    dock?: string;
    open?: boolean;
    order?: LiveEditPanelOrder;
  }): void;

  /**
   * Reconcile persisted data against the current document's live-edit ids.
   *
   * Rules (§7.3):
   * - IDs in both doc and values → value restored (entry retained).
   * - IDs in doc but not in values → no entry created (slot uses seed).
   * - IDs in values but not in doc → moved to orphans with orphanedAt = now.
   * - Orphans older than orphanGcHours → deleted (+ matching midiBindings,
   *   panelOrder entries).
   * - Orphan IDs that reappear in doc → restored from orphans to values.
   *
   * Saves the reconciled data and returns it.
   */
  reconcile(
    currentIds: Set<string>,
    orphanGcHours?: number,
  ): LiveEditPersistedData;

  /** Clean up debounce timers. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createLiveEditPersistence(): LiveEditPersistence {
  // In-memory cache of the current persisted data. Loaded lazily on first
  // access.
  let cached: LiveEditPersistedData | null = null;

  // Pending debounced value saves: id → value
  const pendingValues: Map<string, number | boolean | string> = new Map();
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  function readCache(): LiveEditPersistedData {
    if (cached !== null) {
      return cached;
    }
    const stored = load<LiveEditPersistedData>(
      PERSISTENCE_KEYS.liveEdits,
      DEFAULT_DATA,
    );
    if (stored.schemaVersion !== undefined && stored.schemaVersion > 1) {
      console.warn(
        `[liveEditPersistence] Ignoring persisted data from future schema version ${stored.schemaVersion}; falling back to defaults.`,
      );
      cached = { ...DEFAULT_DATA };
      return cached;
    }
    cached = {
      ...DEFAULT_DATA,
      ...stored,
      schemaVersion: 1,
    };
    return cached;
  }

  function persist(data: LiveEditPersistedData): void {
    cached = data;
    save(PERSISTENCE_KEYS.liveEdits, data);
  }

  function flushDebounced(): void {
    if (pendingValues.size === 0) return;
    const data = readCache();
    const updated: LiveEditPersistedData = {
      ...data,
      values: { ...data.values },
    };
    for (const [id, value] of pendingValues) {
      updated.values[id] = value;
    }
    pendingValues.clear();
    persist(updated);
  }

  // ── Public API ────────────────────────────────────────────────────────────

  function loadData(): LiveEditPersistedData {
    return readCache();
  }

  function saveValue(id: string, value: number | boolean | string): void {
    pendingValues.set(id, value);
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      flushDebounced();
    }, DEBOUNCE_MS);
  }

  function flushValues(
    values: Record<string, number | boolean | string>,
  ): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const pendingSnapshot: Record<string, number | boolean | string> = {};
    for (const [id, val] of pendingValues) {
      pendingSnapshot[id] = val;
    }
    pendingValues.clear();

    const data = readCache();
    persist({
      ...data,
      values: { ...data.values, ...pendingSnapshot, ...values },
    });
  }

  function saveBinding(slotId: string, source: MidiSource): void {
    const data = readCache();
    persist({
      ...data,
      midiBindings: { ...data.midiBindings, [slotId]: source },
    });
  }

  function removeBinding(slotId: string): void {
    const data = readCache();
    const midiBindings = { ...data.midiBindings };
    delete midiBindings[slotId];
    persist({ ...data, midiBindings });
  }

  function savePanelState(state: {
    dock?: string;
    open?: boolean;
    order?: LiveEditPanelOrder;
  }): void {
    const data = readCache();
    const updated: LiveEditPersistedData = { ...data };

    if (state.dock !== undefined) {
      const dock = state.dock as "right" | "bottom" | "left";
      updated.panelDock = dock;
    }
    if (state.open !== undefined) {
      updated.panelOpen = state.open;
    }
    if (state.order !== undefined) {
      // LiveEditPanelOrder.custom is string[] (ordered ids), but the persisted
      // panelOrder.custom is Record<string, string[]>. Convert here.
      if (state.order.mode === "document") {
        updated.panelOrder = { mode: "document" };
      } else {
        updated.panelOrder = {
          mode: "custom",
          custom: { default: state.order.custom ?? [] },
        };
      }
    }
    persist(updated);
  }

  function reconcile(
    currentIds: Set<string>,
    orphanGcHours: number = DEFAULT_ORPHAN_GC_HOURS,
  ): LiveEditPersistedData {
    const data = readCache();
    const now = Date.now();
    const gcThresholdMs = orphanGcHours * 60 * 60 * 1000;

    const values = { ...data.values };
    const orphans = { ...data.orphans };
    const midiBindings = { ...data.midiBindings };

    // 1. Orphan IDs that reappear in doc → restore from orphans to values.
    for (const id of currentIds) {
      if (id in orphans) {
        values[id] = orphans[id].value;
        delete orphans[id];
      }
    }

    // 2. IDs in values but not in doc → move to orphans.
    for (const id of Object.keys(values)) {
      if (!currentIds.has(id)) {
        orphans[id] = { value: values[id], orphanedAt: now };
        delete values[id];
      }
    }

    // 3. Orphans older than GC threshold → delete entirely (+ bindings + panel order).
    const panelOrder = { ...data.panelOrder };
    for (const id of Object.keys(orphans)) {
      if (now - orphans[id].orphanedAt >= gcThresholdMs) {
        delete orphans[id];
        delete midiBindings[id];
        if (panelOrder.custom) {
          for (const docKey of Object.keys(panelOrder.custom)) {
            panelOrder.custom[docKey] = panelOrder.custom[docKey].filter(
              (slotId: string) => slotId !== id,
            );
          }
        }
      }
    }

    const reconciled: LiveEditPersistedData = {
      ...data,
      values,
      orphans,
      midiBindings,
      panelOrder,
    };
    persist(reconciled);
    return reconciled;
  }

  function dispose(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    flushDebounced();
  }

  return {
    load: loadData,
    saveValue,
    flushValues,
    saveBinding,
    removeBinding,
    savePanelState,
    reconcile,
    dispose,
  };
}
