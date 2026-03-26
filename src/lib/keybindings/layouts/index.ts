import { qwertyUs } from "./qwerty-us";
import { qwertyUk } from "./qwerty-uk";
import { dvorak } from "./dvorak";
import { colemak } from "./colemak";
import { azertyFr } from "./azerty-fr";
import { qwertzDe } from "./qwertz-de";
import type { KeyboardLayout, KeyboardLayoutId } from "./types";

export const layouts: Record<KeyboardLayoutId, KeyboardLayout> = {
  "qwerty-us": qwertyUs,
  "qwerty-uk": qwertyUk,
  "dvorak": dvorak,
  "colemak": colemak,
  "azerty-fr": azertyFr,
  "qwertz-de": qwertzDe,
};

export function getLayout(id: KeyboardLayoutId): KeyboardLayout {
  return layouts[id];
}

export async function detectLayout(): Promise<KeyboardLayoutId> {
  // Chromium Keyboard API
  if (
    "keyboard" in navigator &&
    "getLayoutMap" in (navigator as any).keyboard
  ) {
    try {
      const layoutMap = await (navigator as any).keyboard.getLayoutMap();
      // Check a few distinguishing keys
      const keyA = layoutMap.get("KeyA");
      const keyZ = layoutMap.get("KeyZ");
      const keyY = layoutMap.get("KeyY");
      const keyQ = layoutMap.get("KeyQ");
      const keyM = layoutMap.get("KeyM");
      const semicolon = layoutMap.get("Semicolon");

      if (keyA === "q" && keyZ === "w") return "azerty-fr";
      if (keyY === "z" && keyZ === "y") return "qwertz-de";
      if (keyQ === "'" && keyA === "a") return "dvorak";
      if (keyQ === "q" && keyA === "a" && keyZ === "z") {
        // Distinguish Colemak: KeyS produces "r" instead of "s"
        const keyS = layoutMap.get("KeyS");
        if (keyS === "r") return "colemak";
        // Distinguish UK vs US: Backslash produces "#" on UK
        const backslash = layoutMap.get("Backslash");
        if (backslash === "#") return "qwerty-uk";
        return "qwerty-us";
      }
    } catch {
      /* fallback below */
    }
  }
  return "qwerty-us"; // Default fallback
}

export * from "./types";
