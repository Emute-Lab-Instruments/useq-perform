/**
 * Gamepad-intent → structural-dispatcher bridge.
 *
 * Subscribes to the gamepad channels in `src/contracts/gamepadChannels.ts`
 * and routes the relevant intents through the new-core dispatcher.
 *
 * Active only when `structure.useNewCore === true` AND the controller is in
 * structural-navigation mode (toggled by the same `toggleNavMode` channel
 * used by `bindGamepadNavigation`). When inactive, this bridge does nothing
 * and the existing legacy structural path runs unchanged.
 *
 * Mutation gestures: round 2 doesn't bind any new gestures. To exercise the
 * mutation ops by gamepad, the user uses the legacy "open menu" radial
 * (X / LB+A / RB+A) — those don't go through us. For the smoke test, the
 * user can drive nav.next/etc. via dpad. Mutation ops are exposed through
 * the dispatcher and can be wired in round 3 (or driven from the browser
 * console for now via `(window as any).__structDispatch(view, "edit.slurpForward")`).
 */

import type { EditorView } from "@codemirror/view";

import * as ch from "../../../../contracts/gamepadChannels.ts";
import { dispatchAction } from "./dispatcher.ts";

export interface GamepadBridgeHandle {
  dispose(): void;
}

/**
 * Wire gamepad intents to the new structural dispatcher. The bridge consults
 * `isEnabled()` on every event, so toggling the feature flag at runtime
 * takes effect without re-binding. Structural-vs-spatial mode is tracked
 * internally (mirrors the legacy `bindGamepadNavigation`) by subscribing to
 * the `toggleNavMode` channel.
 *
 * The legacy `bindGamepadNavigation` is also active and runs its own nav. To
 * avoid double-driving, see the gating in `bindGamepadNavigation` itself
 * which short-circuits structural-mode handling when the flag is on.
 */
export function bindStructuralGamepadBridge(
  view: EditorView,
  isEnabled: () => boolean,
): GamepadBridgeHandle {
  let navigationMode: "spatial" | "structural" = "spatial";
  const guard = () => isEnabled() && navigationMode === "structural";

  const unsubToggle = ch.toggleNavMode.subscribe(() => {
    navigationMode = navigationMode === "structural" ? "spatial" : "structural";
  });

  const unsubNavigate = ch.navigate.subscribe(({ direction }) => {
    if (!guard()) return;
    // Map d-pad to structural nav. Down/right = next, up/left = prev.
    // This matches the legacy structural mode mapping.
    switch (direction) {
      case "down":
      case "right":
        dispatchAction(view, "nav.next");
        break;
      case "up":
      case "left":
        dispatchAction(view, "nav.prev");
        break;
    }
  });

  const unsubEnter = ch.enter.subscribe(() => {
    if (!guard()) return;
    dispatchAction(view, "nav.down");
  });

  const unsubBack = ch.back.subscribe(() => {
    if (!guard()) return;
    dispatchAction(view, "nav.up");
  });

  return {
    dispose() {
      unsubNavigate();
      unsubEnter();
      unsubBack();
      unsubToggle();
    },
  };
}
