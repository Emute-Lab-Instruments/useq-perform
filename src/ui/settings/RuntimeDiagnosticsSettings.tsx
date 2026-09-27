import { createSignal, onCleanup, onMount } from "solid-js";
import {
  runtimeDiagnostics as runtimeDiagnosticsChannel,
} from "../../contracts/runtimeChannels.ts";
import {
  getDiagnosticsSnapshot,
  type RuntimeDiagnosticsSnapshot,
} from "../../runtime/runtimeDiagnostics.ts";
import { Section } from "./FormControls";

export function RuntimeDiagnosticsSettings() {
  const [snapshot, setSnapshot] = createSignal<RuntimeDiagnosticsSnapshot>(
    getDiagnosticsSnapshot(),
  );

  onMount(() => {
    const unsubscribe = runtimeDiagnosticsChannel.subscribe(setSnapshot);
    onCleanup(unsubscribe);
  });

  return (
    <Section title="Runtime diagnostics" level="advanced">
      <pre class="runtime-diagnostics-snapshot">{JSON.stringify(snapshot(), null, 2)}</pre>
    </Section>
  );
}
