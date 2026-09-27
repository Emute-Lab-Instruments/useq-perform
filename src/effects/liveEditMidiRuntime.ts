/** Production wiring for Web MIDI input, learn, routing, and live-edit values. */
import { createMidiInputService } from "./midiInput.ts";
import { createMidiLearnController } from "./midiLearnController.ts";
import { createMidiRouter } from "./midiRouter.ts";
import { liveEditOnValueChange, liveEditPersistence, liveEditStore } from "./liveEditRuntime.ts";
import type { MidiBinding } from "../contracts/midi.ts";

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

/** Attach message routing for the application-root lifetime. */
export function startLiveEditMidiRuntime(): () => void {
  if (stopListening) return stopListening;
  const unsubscribe = midiInput.onMessage((message) => {
    midiLearnController.handleMessage(message);
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
