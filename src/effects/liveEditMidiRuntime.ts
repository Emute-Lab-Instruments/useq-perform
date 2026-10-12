/** Production wiring for Web MIDI input, learn, routing, and live-edit values. */
import { createMidiInputService } from "./midiInput.ts";
import { createMidiLearnController, type ConflictInfo } from "./midiLearnController.ts";
import { createMidiRouter } from "./midiRouter.ts";
import { liveEditOnValueChange, liveEditPersistence, liveEditStore } from "./liveEditRuntime.ts";
import { notify } from "../contracts/toastChannels.ts";
import type { MidiBinding, MidiSource } from "../contracts/midi.ts";

export const midiInput = createMidiInputService();

export const midiLearnController = createMidiLearnController({
  getBindings: () => new Map(
    Object.entries(liveEditPersistence.load().midiBindings).map(([slotId, source]) => [slotId, { slotId, source } satisfies MidiBinding]),
  ),
  applyBinding: ({ slotId, source }) => liveEditPersistence.saveBinding(slotId, source),
  removeBinding: (slotId) => liveEditPersistence.removeBinding(slotId),
  channelScopeDefault: "specific",
});

const midiRouter = createMidiRouter({
  findBinding(source) {
    return [...midiLearnControllerBindings()].find((binding) => sameSource(binding.source, source));
  },
  getSlotInfo(slotId) {
    const slot = liveEditStore.getSlot(slotId);
    if (!slot || slot.min === undefined || slot.max === undefined) {
      if (!slot || slot.kind === "numeric") return undefined;
    }
    return {
      min: slot.min ?? 0,
      max: slot.max ?? 1,
      kind: slot.kind === "boolean" ? "boolean" : slot.kind === "keyword" ? "keyword" : "numeric",
      options: slot.options,
    };
  },
});

function midiLearnControllerBindings(): MidiBinding[] {
  return Object.entries(liveEditPersistence.load().midiBindings)
    .map(([slotId, source]) => ({ slotId, source }));
}

function sameSource(a: MidiBinding["source"], b: MidiBinding["source"]): boolean {
  if (a.kind !== b.kind || a.channel !== b.channel) return false;
  return a.kind === "cc" && b.kind === "cc"
    ? a.controller === b.controller
    : a.kind === "note" && b.kind === "note" && a.note === b.note && a.mode === b.mode;
}

let stopListening: (() => void) | undefined;

/** Compact source label for the conflict toast (live-edit.md §5.10, e.g. "CC74"). */
function sourceLabel(source: MidiSource): string {
  return source.kind === "cc" ? `CC${source.controller}` : `note ${source.note}`;
}

function slotName(slotId: string): string {
  return liveEditStore.getSlot(slotId)?.name ?? slotId;
}

/**
 * Revert a conflict back to the pre-bind state in one action (§5.10):
 * the target slot loses the learned source, and both its previous binding
 * (if any) and the displaced slot's binding are restored.
 */
function revertConflict(conflict: ConflictInfo): void {
  liveEditPersistence.removeBinding(conflict.slotId);
  if (conflict.replacedBinding) {
    liveEditPersistence.saveBinding(conflict.replacedBinding.slotId, conflict.replacedBinding.source);
  }
  liveEditPersistence.saveBinding(conflict.previousSlotId, conflict.source);
}

/** §5.10: binding a source that is already bound moves it and offers Undo. */
function showConflictToast(conflict: ConflictInfo): void {
  notify({
    message: `${sourceLabel(conflict.source)} moved from \`${slotName(conflict.previousSlotId)}\` to \`${slotName(conflict.slotId)}\`.`,
    kind: "info",
    durationMs: 6000,
    action: { label: "Undo", run: () => revertConflict(conflict) },
  });
}

/** Attach message routing for the application-root lifetime. */
export function startLiveEditMidiRuntime(): () => void {
  if (stopListening) return stopListening;
  const unsubscribe = midiInput.onMessage((message) => {
    const conflict = midiLearnController.handleMessage(message);
    if (conflict) showConflictToast(conflict);
    for (const update of midiRouter.route(message)) {
      liveEditOnValueChange(update.slotId, update.value);
    }
  });
  stopListening = () => {
    unsubscribe();
    stopListening = undefined;
  };
  return stopListening;
}
