import { For } from "solid-js";

import "./vis-legend.css";

export interface VisLegendChannel {
  channel: string;
  color: string | null;
  active: boolean;
  label: string;
}

export interface VisLegendProps {
  channels: VisLegendChannel[];
  class?: string;
}

export function VisLegend(props: VisLegendProps) {
  return (
    <div class={props.class ?? "vis-legend"}>
      <For each={props.channels}>
        {(entry) => (
          <div
            class="vis-legend-entry"
            classList={{ "vis-legend-entry--inactive": !entry.active }}
            style={{ "--swatch": entry.color ?? "transparent" }}
          >
            <div
              class="vis-legend-swatch"
              classList={{ "vis-legend-swatch--empty": !entry.color }}
            />
            <span class="vis-legend-label">{entry.label}</span>
          </div>
        )}
      </For>
    </div>
  );
}
