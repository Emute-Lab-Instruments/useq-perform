// Live-slot id → index map for the §6.5 binary INPUT_SET fast-path.
//
// The §6.5 binary `INPUT_SET` frame addresses live-input slots by their
// integer `slot_index`: a zero-based DIRECT index into the device's
// `engine->pool.live_slots[0 .. live_slot_count)` table. That table is the
// same one `set-live-inputs` (§5.8) writes after resolving its string `:id`
// keys, and it is (re)allocated in declaration order on every successful eval.
//
// The editor reads `id → index` from get-state's `liveSlots` array
// (state-sync.md §2): the array is in declaration order, so the index of an
// entry IS its `slot_index`. This map MUST be re-synced after every successful
// eval (eval re-allocates the table). Until it is synced, callers fall back to
// the JSON `set-live-inputs` path — `resolveLiveSlotIndex` returns `null`,
// signalling "not synced; use the slow path".
//
// Kept in `src/lib/` (no upward imports) so both the transport layer and the
// editor command router can depend on it without crossing import boundaries.

export interface LiveSlotDeclaration {
  id: string;
}

let idToIndex: Map<string, number> | null = null;

/**
 * Re-sync the `id → slot_index` map from a get-state `liveSlots` array.
 * Declaration order == index, matching the device's live-slot table layout.
 * Pass `null`/empty to invalidate (forces fallback to set-live-inputs).
 */
export function syncLiveSlotIndex(
  liveSlots: ReadonlyArray<LiveSlotDeclaration> | null | undefined,
): void {
  if (!liveSlots || liveSlots.length === 0) {
    idToIndex = null;
    return;
  }
  const map = new Map<string, number>();
  liveSlots.forEach((slot, index) => {
    if (slot && typeof slot.id === "string") {
      // First declaration wins on duplicate ids (declaration order is index).
      if (!map.has(slot.id)) map.set(slot.id, index);
    }
  });
  idToIndex = map.size > 0 ? map : null;
}

/**
 * Resolve a live-input id to its device `slot_index`.
 * Returns `null` when the map is unsynced or the id is unknown — the caller
 * MUST then fall back to the JSON `set-live-inputs` path (§6.5 NOTE).
 */
export function resolveLiveSlotIndex(id: string): number | null {
  if (!idToIndex) return null;
  const index = idToIndex.get(id);
  return typeof index === "number" ? index : null;
}

/** True once a get-state sync has populated the map. */
export function isLiveSlotIndexSynced(): boolean {
  return idToIndex !== null;
}

/** Invalidate the map (e.g. on disconnect / protocol reset). */
export function clearLiveSlotIndex(): void {
  idToIndex = null;
}
