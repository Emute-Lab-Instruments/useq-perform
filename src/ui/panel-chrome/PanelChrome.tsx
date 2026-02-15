import { Switch, Match } from "solid-js";
import type { ChromeDesign, ChromeProps } from "./types";
import { PaneChrome } from "./PaneChrome";
import { DrawerChrome } from "./DrawerChrome";
import { TileChrome } from "./TileChrome";
import { activeChromeDesign } from "./DesignSelector";

export interface PanelChromeProps extends ChromeProps {
  /** Override the global design. If omitted, uses activeChromeDesign signal. */
  design?: ChromeDesign;
}

export function PanelChrome(props: PanelChromeProps) {
  const design = () => props.design ?? activeChromeDesign();

  return (
    <Switch>
      <Match when={design() === "pane"}>
        <PaneChrome panelId={props.panelId} title={props.title} onClose={props.onClose}>
          {props.children}
        </PaneChrome>
      </Match>
      <Match when={design() === "drawer"}>
        <DrawerChrome panelId={props.panelId} title={props.title} onClose={props.onClose}>
          {props.children}
        </DrawerChrome>
      </Match>
      <Match when={design() === "tile"}>
        <TileChrome panelId={props.panelId} title={props.title} onClose={props.onClose}>
          {props.children}
        </TileChrome>
      </Match>
    </Switch>
  );
}
