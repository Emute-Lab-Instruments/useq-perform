// src/ui/liveEdit/LiveEditPanel.tsx
//
// The dockable live-edit panel — spec: docs/specs/live-edit.md §5.1, §5.2, §5.4.
//
// Pure prop-driven SolidJS component. No imports from runtime/effects/transport
// or any persistence layer. The panel is renderable in isolation given a slot
// list, MIDI bindings, learn state, and a focused-slot id.
//
// What this file does:
//   - lays out the dockable panel chrome (header + close + reset-order)
//   - renders the listening banner when MIDI learn is armed
//   - sorts cards per `LiveEditPanelOrder` (document order or persisted custom)
//   - renders one `LiveEditCard` per slot
//   - wires per-card callbacks back up to the parent
//
// What this file does NOT do:
//   - actual drag-and-drop reordering (callback is exposed; drag handle is
//     visual-only — see §5.1.4)
//   - MIDI learn flow internals (delegated to gii8.43; learn state arrives
//     here as a prop)
//   - persistence / ordering storage (panel is a pure view)

import { For, Show, createMemo } from "solid-js";
import type {
  LiveEditPanelOrder,
  LiveEditSlot,
  SlotValue,
} from "../../contracts/liveEdit.ts";
import type { MidiBinding, MidiLearnState } from "../../contracts/midi.ts";
import { LiveEditCard } from "./LiveEditCard.tsx";

import "./LiveEditPanel.css";

export interface LiveEditPanelProps {
  slots: LiveEditSlot[];
  order: LiveEditPanelOrder;
  /** slotId -> binding. */
  bindings: Map<string, MidiBinding>;
  learnState: MidiLearnState;
  /** Currently focused slot (gamepad/cursor focus follows-cursor — §5.2). */
  focusedSlotId?: string;

  onValueChange: (slotId: string, value: SlotValue) => void;
  onRename: (slotId: string, name: string) => void;
  onResetToSeed: (slotId: string) => void;
  onUnmark: (slotId: string) => void;
  onStartLearn: (slotId: string) => void;
  onClearBinding: (slotId: string) => void;

  /** Called with the new ordered list of slot ids. */
  onReorder: (newOrder: string[]) => void;
  /** §5.1.4: switch back to document-order. */
  onResetOrder: () => void;
  /** Close the panel (toolbar/keybinding still owns open state). */
  onClose: () => void;
}

export function LiveEditPanel(props: LiveEditPanelProps) {
  const orderedSlots = createMemo<LiveEditSlot[]>(() => {
    const slots = props.slots;
    if (props.order.mode === "document" || !props.order.custom) {
      return slots;
    }
    const byId = new Map(slots.map((s) => [s.id, s]));
    const result: LiveEditSlot[] = [];
    const seen = new Set<string>();
    // First, slots in the persisted custom order…
    for (const id of props.order.custom) {
      const slot = byId.get(id);
      if (slot) {
        result.push(slot);
        seen.add(id);
      }
    }
    // …then any slots not yet in the custom order, appended at the end
    // (newly-added live-edits, per §5.1.4).
    for (const slot of slots) {
      if (!seen.has(slot.id)) result.push(slot);
    }
    return result;
  });

  const listeningBanner = createMemo(() => {
    const ls = props.learnState;
    if (ls.mode === "idle") return null;
    if (ls.mode === "single") {
      const slot = props.slots.find((s) => s.id === ls.slotId);
      const label = slot?.name ?? `unnamed-${ls.slotId}`;
      return `Listening for MIDI on ${label}…  Esc ✗`;
    }
    // batch
    const slot = props.slots.find((s) => s.id === ls.slotIds[ls.index]);
    const label = slot?.name ?? `unnamed-${ls.slotIds[ls.index] ?? ""}`;
    return `Listening for MIDI on ${label} (${ls.index + 1}/${ls.slotIds.length})…  N skip   Esc ✗`;
  });

  const isListening = (slotId: string): boolean => {
    const ls = props.learnState;
    if (ls.mode === "idle") return false;
    if (ls.mode === "single") return ls.slotId === slotId;
    return ls.slotIds[ls.index] === slotId;
  };

  return (
    <div class="le-panel-root" role="region" aria-label="Live-edit panel">
      <header class="le-panel-header">
        <h2 class="le-panel-title">Live edits</h2>
        <div class="le-panel-header-actions">
          <Show when={props.order.mode === "custom"}>
            <button
              type="button"
              class="le-panel-icon-button"
              onClick={() => props.onResetOrder()}
              title="Reset card order to document order"
            >
              ↺ doc-order
            </button>
          </Show>
          <button
            type="button"
            class="le-panel-icon-button"
            onClick={() => props.onClose()}
            title="Close panel"
            aria-label="Close panel"
          >
            ✕
          </button>
        </div>
      </header>

      <Show when={listeningBanner()}>
        {(banner) => <div class="le-panel-banner" role="status">{banner()}</div>}
      </Show>

      <Show
        when={orderedSlots().length > 0}
        fallback={
          <div class="le-panel-empty">
            <div>No live-edits yet.</div>
            <div class="le-panel-empty-hint">
              Mark a literal in the editor with{" "}
              <kbd>liveEdit.mark</kbd> to add a knob here.
            </div>
          </div>
        }
      >
        <div
          class="le-panel-card-list"
          role="list"
          onDragEnd={() => {
            // Stub: real drag-to-reorder logic will compute the new order
            // from drop position and call `onReorder`. For now just expose
            // the callback path.
            props.onReorder(orderedSlots().map((s) => s.id));
          }}
        >
          <For each={orderedSlots()}>
            {(slot) => (
              <div role="listitem">
                <LiveEditCard
                  slot={slot}
                  binding={props.bindings.get(slot.id)}
                  listening={isListening(slot.id)}
                  focused={props.focusedSlotId === slot.id}
                  onValueChange={(v) => props.onValueChange(slot.id, v)}
                  onRename={(n) => props.onRename(slot.id, n)}
                  onResetToSeed={() => props.onResetToSeed(slot.id)}
                  onUnmark={() => props.onUnmark(slot.id)}
                  onStartLearn={() => props.onStartLearn(slot.id)}
                  onClearBinding={() => props.onClearBinding(slot.id)}
                />
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
