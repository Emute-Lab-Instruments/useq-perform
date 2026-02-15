import { createSignal, For, Show } from "solid-js";
import type { ChromeDesign } from "./types";

/** Module-level signal controlling which chrome design is active globally. */
const [_activeChromeDesign, _setActiveChromeDesign] = createSignal<ChromeDesign>("pane");
export const activeChromeDesign = _activeChromeDesign;
export const setActiveChromeDesign = _setActiveChromeDesign;

const DESIGNS: ChromeDesign[] = ["pane", "drawer", "tile"];

/**
 * Floating widget (bottom-left, z-index 25) that lets devmode users switch
 * between the three chrome design modes. Only rendered when devmode === true.
 */
export function DesignSelector(props: { devmode: boolean }) {
  return (
    <Show when={props.devmode}>
      <div class="design-selector">
        <For each={DESIGNS}>
          {(d) => (
            <button
              classList={{ active: activeChromeDesign() === d }}
              onClick={() => setActiveChromeDesign(d)}
            >
              {d}
            </button>
          )}
        </For>
      </div>
    </Show>
  );
}
