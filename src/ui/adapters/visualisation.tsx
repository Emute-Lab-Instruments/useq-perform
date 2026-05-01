/**
 * Visualisation adapters - Wired wrappers that read from the global
 * visualisation store and pass data as props to pure vis components.
 *
 * Note: serialVisGL.ts is a WebGL renderer tightly coupled to the store
 * for performance (reading buffer data every animation frame). Only
 * SolidJS components are adapted here.
 */
import { visStore } from "../../utils/visualisationStore";
import { InternalVis } from "../InternalVis";

// ── Wired visualisation components ─────────────────────────────────

export function WiredInternalVis() {
  return (
    <InternalVis
      serialBuffers={visStore.serialBuffers}
      palette={visStore.palette}
    />
  );
}
