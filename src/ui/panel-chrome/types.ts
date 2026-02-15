import type { JSX } from "solid-js";

/** Absolute pixel geometry for a panel window. */
export interface Geometry {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The three chrome design modes. */
export type ChromeDesign = "pane" | "drawer" | "tile";

/** Panel visibility/interaction state. */
export type ChromeMode = "normal" | "expanded" | "collapsed";

/** Tile layout slot names. */
export type TileSlot =
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
}
