import { For, Show } from "solid-js";
import {
  visStore,
  SERIAL_VIS_CHANNELS,
  type SerialVisChannel,
} from "../utils/visualisationStore";

export interface VisLegendProps {
  class?: string;
}

export function VisLegend(props: VisLegendProps) {
  const activeEntries = () => {
    const expressions = visStore.expressions;
    const palette = visStore.palette;
    const offset = visStore.settings.circularOffset ?? 0;

    return SERIAL_VIS_CHANNELS.map((channel, index) => {
      const expr = expressions[channel];
      const clampedOffset = ((offset % SERIAL_VIS_CHANNELS.length) + SERIAL_VIS_CHANNELS.length) % SERIAL_VIS_CHANNELS.length;
      const paletteIndex =
        palette.length > 0
          ? (index + clampedOffset) % palette.length
          : -1;
      const color = expr?.color ?? (paletteIndex >= 0 ? palette[paletteIndex] : null);

      return {
        channel,
        color,
        active: !!expr,
        label: expr?.expressionText ?? channel,
      };
    });
  };

  return (
    <div class={props.class ?? "vis-legend"}>
      <For each={activeEntries()}>
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
