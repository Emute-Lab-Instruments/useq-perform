export interface KeyDef {
  /** Physical key code (KeyboardEvent.code): "KeyA", "BracketLeft", etc. */
  code: string;
  /** Display label for this key in this layout */
  label: string;
  /** Width multiplier (1 = standard key, 1.5 = wider, 6.25 = spacebar, etc.) */
  w?: number;
  /** True for gap/spacer elements that aren't real keys */
  gap?: boolean;
}

export interface KeyboardLayout {
  id: string;
  name: string;
  rows: KeyDef[][];
}

export type KeyboardLayoutId =
  | "qwerty-us"
  | "qwerty-uk"
  | "dvorak"
  | "colemak"
  | "azerty-fr"
  | "qwertz-de";
