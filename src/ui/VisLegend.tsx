import { For } from "solid-js";

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
            style={{
              display: "flex",
              "align-items": "center",
              gap: "6px",
              opacity: entry.active ? "1" : "0.4",
            }}
          >
            <div
              class="vis-legend-swatch"
              style={{
                width: "12px",
                height: "12px",
                "border-radius": "2px",
                "background-color": entry.color ?? "transparent",
                border: entry.color ? "none" : "1px solid rgba(255,255,255,0.3)",
                "flex-shrink": "0",
              }}
            />
            <span
              class="vis-legend-label"
              style={{
                "font-size": "11px",
                "font-family": "monospace",
                "white-space": "nowrap",
                overflow: "hidden",
                "text-overflow": "ellipsis",
              }}
            >
              {entry.label}
            </span>
          </div>
        )}
      </For>
    </div>
  );
}
