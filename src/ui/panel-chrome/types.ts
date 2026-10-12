import type { JSX } from "solid-js";
import type { PanelChromeDesign } from "../../lib/settings/schema";

/** Absolute pixel geometry for a panel window. */
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three chrome design modes (persisted as `settings.ui.panelChrome`). */
export type ChromeDesign = PanelChromeDesign;

/** Panel visibility/interaction state. */
export type ChromeMode = "normal" | "expanded" | "collapsed";

/** Viewport side a panel docks to by default (side-by-side panels). */
export type PanelSide = "left" | "right";

/** Tile layout slot names. */
export type TileSlot =
  | "left-third"
  | "left-half"
  | "right-third"
  | "right-half"
  | "bottom-half"
  | "bottom-right"
  | "center-large"
  | "top-right";

/** Common props shared by all chrome design components. */
export interface ChromeProps {
  /** Unique identifier for this panel (e.g. "settings", "help"). */
  panelId: string;
  /** Display title shown in the chrome title bar. */
  title: string;
  /** Panel content. */
  children: JSX.Element;
  /** Called when the user closes the panel. */
  onClose: () => void;
  /** Default docking side when no geometry is stored. Defaults to "right". */
  side?: PanelSide;
  /**
   * Position in the panel stacking order (0 = bottom). Added to the base
   * panel z-index so the most recently raised panel paints on top.
   */
  stackIndex?: number;
}
