import { Switch, Match } from "solid-js";
import type { ChromeDesign, ChromeProps } from "./types";
import { PaneChrome } from "./PaneChrome";
import { DrawerChrome } from "./DrawerChrome";
import { TileChrome } from "./TileChrome";

export interface PanelChromeProps extends ChromeProps {
  /**
   * Chrome design to render. The application wires this to
   * `settings.ui.panelChrome` (see `src/ui/adapters/panels.tsx`).
   * Defaults to "pane".
   */
  design?: ChromeDesign;
}

export function PanelChrome(props: PanelChromeProps) {
  const design = () => props.design ?? "pane";

  return (
    <Switch>
      <Match when={design() === "pane"}>
        <PaneChrome
          panelId={props.panelId}
          title={props.title}
          onClose={props.onClose}
          side={props.side}
          stackIndex={props.stackIndex}
        >
          {props.children}
        </PaneChrome>
      </Match>
      <Match when={design() === "drawer"}>
        <DrawerChrome
          panelId={props.panelId}
          title={props.title}
          onClose={props.onClose}
          side={props.side}
          stackIndex={props.stackIndex}
        >
          {props.children}
        </DrawerChrome>
      </Match>
      <Match when={design() === "tile"}>
        <TileChrome
          panelId={props.panelId}
          title={props.title}
          onClose={props.onClose}
          side={props.side}
          stackIndex={props.stackIndex}
        >
          {props.children}
        </TileChrome>
      </Match>
    </Switch>
  );
}
