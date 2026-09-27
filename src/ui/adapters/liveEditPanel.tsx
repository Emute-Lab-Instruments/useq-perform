/**
 * Wired adapter for the live-edit panel.
 *
 * Reads live-edit slot state from the store, panel/binding state from
 * persistence, and MIDI learn state from the learn controller. Maps all of
 * this into LiveEditPanelProps and renders the pure LiveEditPanel component.
 *
 * The MIDI learn controller uses callbacks rather than SolidJS signals, so
 * this adapter bridges them: it holds a createSignal for the learn state and
 * subscribes to the controller's onStateChanged callback on mount.
 *
 * Follows the Wired-component adapter pattern documented in CLAUDE.md.
 *
 * Spec: docs/specs/live-edit.md §5.1–§5.4, §5.7–§5.11
 */
import { createSignal, onCleanup, onMount } from "solid-js";
import { Show } from "solid-js";
import { LiveEditPanel } from "../liveEdit/LiveEditPanel.tsx";
import type { LiveEditStoreAPI } from "../../effects/liveEditStore.ts";
import type { LiveEditPersistence } from "../../effects/liveEditPersistence.ts";
import type { MidiLearnController } from "../../effects/midiLearnController.ts";
import type {
  LiveEditPanelOrder,
  LiveEditSlot,
  SlotValue,
} from "../../contracts/liveEdit.ts";
import type { MidiBinding, MidiLearnState } from "../../contracts/midi.ts";
import type { MidiInputService } from "../../effects/midiInput.ts";
import type { MidiPermissionState } from "../../contracts/midi.ts";
import { liveEditOnValueChange } from "../../effects/liveEditRuntime.ts";

// ── Deps type ────────────────────────────────────────────────────────────────

export interface LiveEditPanelAdapterDeps {
  store: LiveEditStoreAPI;
  persistence: LiveEditPersistence;
  learnController: MidiLearnController;
  midiInput: MidiInputService;
}

let externalToggle: (() => void) | undefined;
let externalLearnAll: (() => void) | undefined;

/** Imperative action target for toolbar and keybinding adapters. */
export function toggleLiveEditPanel(): void {
  externalToggle?.();
}

/** Imperative action target for the toolbar's LEARN ALL button (live-edit.md §5.8.2). */
export function startLiveEditLearnAll(): void {
  externalLearnAll?.();
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Convert the flat midiBindings record from persistence into a Map<slotId, MidiBinding>.
 */
function bindingsMap(
  raw: Record<string, import("../../contracts/midi.ts").MidiSource>,
): Map<string, MidiBinding> {
  const map = new Map<string, MidiBinding>();
  for (const [slotId, source] of Object.entries(raw)) {
    map.set(slotId, { slotId, source });
  }
  return map;
}

/**
 * Convert the persisted panelOrder shape into the LiveEditPanelOrder contract type.
 * The persisted custom field is `Record<string, string[]>` (keyed by "default");
 * the panel prop expects `string[] | undefined`.
 */
function toOrderProp(
  persisted: { mode: "document" | "custom"; custom?: Record<string, string[]> },
): LiveEditPanelOrder {
  if (persisted.mode === "document" || !persisted.custom) {
    return { mode: "document" };
  }
  return {
    mode: "custom",
    custom: persisted.custom["default"] ?? [],
  };
}

// ── WiredPanel component ─────────────────────────────────────────────────────

export function WiredLiveEditPanel(deps: LiveEditPanelAdapterDeps) {
  // Load initial persisted state once.
  const initialData = deps.persistence.load();

  // Panel state: order, open. These are derived from persistence but managed
  // locally as signals so the component can react to close/reorder without
  // a persistence round-trip.
  const [order, setOrder] = createSignal<LiveEditPanelOrder>(
    toOrderProp(initialData.panelOrder),
  );
  const [isOpen, setIsOpen] = createSignal(initialData.panelOpen);
  const [dock, setDock] = createSignal<"right" | "bottom" | "left">(initialData.panelDock);
  const [bindings, setBindings] = createSignal<Map<string, MidiBinding>>(
    bindingsMap(initialData.midiBindings),
  );

  // Bridge the learn controller's callback-based state to a SolidJS signal.
  const [learnState, setLearnState] = createSignal<MidiLearnState>(
    deps.learnController.state,
  );
  const [midiPermission, setMidiPermission] = createSignal<MidiPermissionState>(deps.midiInput.permission);

  onMount(() => {
    externalToggle = () => {
      const open = !isOpen();
      setIsOpen(open);
      deps.persistence.savePanelState({ open });
    };
    // §5.8.2 batch learn reports its progress through the panel banner, so
    // make sure the panel is visible before arming the cards.
    externalLearnAll = () => {
      if (!isOpen()) {
        setIsOpen(true);
        deps.persistence.savePanelState({ open: true });
      }
      handleStartLearnAll();
    };
    onCleanup(() => { externalToggle = undefined; });
    onCleanup(() => { externalLearnAll = undefined; });
    const unsubscribe = deps.learnController.onStateChanged((state) => {
      setLearnState(state);
      setBindings(bindingsMap(deps.persistence.load().midiBindings));
    });
    const unsubscribePermission = deps.midiInput.onPermissionChanged(setMidiPermission);
    onCleanup(unsubscribe);
    onCleanup(unsubscribePermission);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && learnState().mode !== "idle") {
        deps.learnController.cancel();
      } else if (event.key.toLowerCase() === "n" && learnState().mode === "batch") {
        deps.learnController.skip();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
  });

  // ── Callbacks ────────────────────────────────────────────────────────────

  function handleValueChange(slotId: string, value: SlotValue): void {
    liveEditOnValueChange(slotId, value as number | boolean | string);
  }

  function handleRename(slotId: string, name: string): void {
    // The store doesn't have a first-class rename API — names live on the slot
    // object. Update via replaceAll with the targeted slot's name mutated.
    const current = deps.store.slots;
    const updated = (current as LiveEditSlot[]).map((s) =>
      s.id === slotId ? { ...s, name } : s,
    );
    deps.store.replaceAll(updated);
  }

  function handleResetToSeed(slotId: string): void {
    const slot = deps.store.getSlot(slotId);
    if (!slot) return;
    liveEditOnValueChange(slotId, slot.seed as number | boolean | string);
  }

  function handleUnmark(slotId: string): void {
    // Unmark requires an EditorView to replace source text — not available in
    // this adapter layer. Log the intent; the full implementation will be wired
    // when the editor-side unmark action is exposed as a channel/callback.
    console.log(
      "[liveEditPanel] unmark from panel — needs editor view, slotId:",
      slotId,
    );
  }

  function handleStartLearn(slotId: string): void {
    const active = deps.learnController.state;
    if (active.mode === "single" && active.slotId === slotId || active.mode === "batch" && active.slotIds[active.index] === slotId) {
      deps.learnController.cancel();
      return;
    }
    deps.learnController.startSingle(slotId);
  }

  function handleStartLearnAll(): void {
    if (deps.learnController.state.mode === "batch") {
      deps.learnController.cancel();
      return;
    }
    const slots = deps.store.slots as LiveEditSlot[];
    deps.learnController.startBatch(slots.map((slot) => slot.id));
  }

  function handleClearBinding(slotId: string): void {
    deps.persistence.removeBinding(slotId);
    // Refresh local bindings signal from the now-updated persistence cache.
    setBindings(bindingsMap(deps.persistence.load().midiBindings));
  }

  function handleReorder(newOrder: string[]): void {
    const next: LiveEditPanelOrder = { mode: "custom", custom: newOrder };
    setOrder(next);
    deps.persistence.savePanelState({ order: next });
  }

  function handleResetOrder(): void {
    const next: LiveEditPanelOrder = { mode: "document" };
    setOrder(next);
    deps.persistence.savePanelState({ order: next });
  }

  function handleClose(): void {
    setIsOpen(false);
    deps.persistence.savePanelState({ open: false });
  }

  return (
    <>
    <Show when={!isOpen()}>
      <button type="button" class="le-panel-reopen" onClick={() => { setIsOpen(true); deps.persistence.savePanelState({ open: true }); }}>Live edits</button>
    </Show>
    <Show when={isOpen()}>
    <LiveEditPanel
      slots={deps.store.slots as LiveEditSlot[]}
      order={order()}
      bindings={bindings()}
      learnState={learnState()}
      midiPermission={midiPermission()}
      dock={dock()}
      onValueChange={handleValueChange}
      onRename={handleRename}
      onResetToSeed={handleResetToSeed}
      onUnmark={handleUnmark}
      onStartLearn={handleStartLearn}
      onStartLearnAll={handleStartLearnAll}
      onRequestMidiAccess={() => void deps.midiInput.requestAccess()}
      onDockChange={(nextDock) => { setDock(nextDock); deps.persistence.savePanelState({ dock: nextDock }); }}
      onClearBinding={handleClearBinding}
      onReorder={handleReorder}
      onResetOrder={handleResetOrder}
      onClose={handleClose}
    />
    </Show>
    </>
  );
}
