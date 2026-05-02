// src/ui/liveEdit/MidiLearnConflict.tsx
//
// Modal asking the user how to resolve a MIDI binding conflict (§5.10).
//
// The spec's default is to *replace* the existing binding and surface a toast
// with an Undo. This dialog covers the explicit-confirmation variant the
// designer wants for batch learn or for users who don't want silent rebinds.
// It is rendered when an incoming CC/note matches an already-bound slot and
// the editor has been configured to ask first.

import type { MidiSource } from "../../contracts/midi";
import { Modal, type OverlayRegisterFn } from "../Modal";
import { formatMidiSourceLabel } from "./MidiLearnAffordance";
import "./MidiLearn.css";

export interface MidiLearnConflictProps {
  incoming: MidiSource;
  existingBoundSlot: { id: string; name: string };
  newSlot: { id: string; name: string };
  onRebind: () => void;
  onKeepExisting: () => void;
  onCancel: () => void;
  /** Optional hook into the overlay manager (for Esc handling / scroll lock). */
  onOverlayRegister?: OverlayRegisterFn;
}

export function MidiLearnConflict(props: MidiLearnConflictProps) {
  return (
    <Modal
      id="midi-learn-conflict"
      title="MIDI source already bound"
      onClose={props.onCancel}
      onOverlayRegister={props.onOverlayRegister}
    >
      <div class="midi-learn-conflict">
        <p>
          The incoming{" "}
          <span class="midi-learn-conflict__source">
            {formatMidiSourceLabel(props.incoming)}
          </span>{" "}
          is already bound to{" "}
          <span class="midi-learn-conflict__slot-name">
            {props.existingBoundSlot.name}
          </span>
          .
        </p>

        <div class="midi-learn-conflict__detail">
          <span class="midi-learn-conflict__detail-label">Source</span>
          <span class="midi-learn-conflict__source">
            {formatMidiSourceLabel(props.incoming)}
          </span>
          <span class="midi-learn-conflict__detail-label">Currently bound</span>
          <span class="midi-learn-conflict__slot-name">
            {props.existingBoundSlot.name}
          </span>
          <span class="midi-learn-conflict__detail-label">Rebind to</span>
          <span class="midi-learn-conflict__slot-name">
            {props.newSlot.name}
          </span>
        </div>

        <p class="midi-learn-conflict__hint">
          One source can only drive one slot. Rebinding will move the source
          from <strong>{props.existingBoundSlot.name}</strong> to{" "}
          <strong>{props.newSlot.name}</strong>.
        </p>

        <div class="midi-learn-conflict__actions">
          <button class="toolbar-button" onClick={props.onCancel}>
            Cancel
          </button>
          <button class="toolbar-button" onClick={props.onKeepExisting}>
            Keep existing
          </button>
          <button class="toolbar-button primary" onClick={props.onRebind}>
            Rebind to {props.newSlot.name}
          </button>
        </div>
      </div>
    </Modal>
  );
}
