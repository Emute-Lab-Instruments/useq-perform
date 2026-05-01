/**
 * Visualisation adapters - Wired wrappers that read from the global
 * visualisation store and pass data as props to pure vis components.
 *
 * Note: serialVisGL.ts exposes a pure `drawSerialVisGL(input)` entry plus
 * a `drawSerialVisGLFromStores()` wrapper.  The wired wrapper is invoked
 * from `visualisationPanel.ts`'s render hook.  Only SolidJS components
 * are adapted here.
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
