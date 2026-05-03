/**
 * Reactive store tracking all live-edit slots in the current document.
 *
 * Spec: docs/specs/live-edit.md
 *
 * This is the central coordination point for live-edit state. Other modules
 * (mark action, widgets, panel, MIDI, persistence) read from or write to
 * this store.
 *
 * The store is a SolidJS reactive store wrapping an array of LiveEditSlot
 * objects. The API methods are thin wrappers around `setStore` calls.
 */

import { createStore } from "solid-js/store";
import type { LiveEditSlot, SlotValue, SlotWidgetState } from "../contracts/liveEdit.ts";

export interface LiveEditStoreAPI {
  /** Reactive accessor: current slots. */
  readonly slots: readonly LiveEditSlot[];

  /** Register a new slot (after marking). */
  registerSlot(slot: LiveEditSlot): void;

  /** Remove a slot (after unmarking). */
  removeSlot(id: string): void;

  /** Update a slot's value (from widget, MIDI, gamepad, panel). */
  setValue(id: string, value: SlotValue): void;

  /** Update a slot's widget state. */
  setState(id: string, state: SlotWidgetState): void;

  /** Get a slot by id. */
  getSlot(id: string): LiveEditSlot | undefined;

  /** Replace all slots (e.g. after reconciliation on reload). */
  replaceAll(slots: LiveEditSlot[]): void;

  /** Get all current values as a record for set-live-inputs. */
  getValuesRecord(): Record<string, SlotValue>;
}

export function createLiveEditStore(): LiveEditStoreAPI {
  const [store, setStore] = createStore<{ slots: LiveEditSlot[] }>({
    slots: [],
  });

  function registerSlot(slot: LiveEditSlot): void {
    // Avoid duplicates — if a slot with this id already exists, replace it.
    const idx = store.slots.findIndex((s) => s.id === slot.id);
    if (idx !== -1) {
      setStore("slots", idx, slot);
    } else {
      setStore("slots", (prev) => [...prev, slot]);
    }
  }

  function removeSlot(id: string): void {
    setStore("slots", (prev) => prev.filter((s) => s.id !== id));
  }

  function setValue(id: string, value: SlotValue): void {
    const idx = store.slots.findIndex((s) => s.id === id);
    if (idx === -1) return;
    const slot = store.slots[idx]!;
    setStore("slots", idx, "value", value);
    setStore("slots", idx, "modified", isModified(value, slot.seed, slot.step));
  }

  function isModified(value: SlotValue, seed: SlotValue, step?: number): boolean {
    if (typeof value === "number" && typeof seed === "number") {
      const threshold = (step ?? 0.01) / 2;
      return Math.abs(value - seed) > threshold;
    }
    return value !== seed;
  }

  function setState(id: string, state: SlotWidgetState): void {
    const idx = store.slots.findIndex((s) => s.id === id);
    if (idx === -1) return;
    setStore("slots", idx, "state", state);
  }

  function getSlot(id: string): LiveEditSlot | undefined {
    return store.slots.find((s) => s.id === id);
  }

  function replaceAll(slots: LiveEditSlot[]): void {
    setStore("slots", slots);
  }

  function getValuesRecord(): Record<string, SlotValue> {
    const record: Record<string, SlotValue> = {};
    for (const slot of store.slots) {
      record[slot.id] = slot.value;
    }
    return record;
  }

  return {
    get slots() {
      return store.slots;
    },
    registerSlot,
    removeSlot,
    setValue,
    setState,
    getSlot,
    replaceAll,
    getValuesRecord,
  };
}
