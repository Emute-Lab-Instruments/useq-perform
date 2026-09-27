// src/contracts/visualisationChannels.ts
//
// Typed pub/sub channels for visualisation events.  Replaces the old
// window CustomEvent dispatch/listen infrastructure in visualisationEvents.ts.

import { createChannel, type TypedChannel } from "../lib/typedChannel";
import type {
  SerialVisPaletteChangedDetail,
  VisualisationSessionDetail,
} from "./visualisationEvents";

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

/** Fires on every visualisation state change (time, data, settings, etc.). */
export const visualisationSessionChannel: TypedChannel<VisualisationSessionDetail> =
  createChannel<VisualisationSessionDetail>();

/** Fires when the serial-vis colour palette changes (theme swap, etc.). */
export const serialVisPaletteChangedChannel: TypedChannel<SerialVisPaletteChangedDetail> =
  createChannel<SerialVisPaletteChangedDetail>();
