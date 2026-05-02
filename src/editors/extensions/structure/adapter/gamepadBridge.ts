/**
 * Gamepad-intent → structural-dispatcher bridge.
 *
 * Subscribes to the gamepad channels in `src/contracts/gamepadChannels.ts`
 * and routes the relevant intents through the structural dispatcher.
 *
 * Active only while the controller is in structural-navigation mode
 * (toggled by the same `toggleNavMode` channel used by
 * `bindGamepadNavigation`). The `isEnabled` predicate is retained so callers
 * can gate the bridge for mode-specific bring-up (e.g. zen mode).
 *
 * Mutation gestures: this bridge currently only handles nav intents. To
 * exercise mutation ops by gamepad, the user uses the radial menu
 * (X / LB+A / RB+A) — those flow through `gamepadMenuBridge`. The dispatcher
 * is also exposed on `(window as any).__structDispatch` for console use.
 */

import type { EditorView } from "@codemirror/view";

import * as ch from "../../../../contracts/gamepadChannels.ts";
import { dispatchAction } from "./dispatcher.ts";

export interface GamepadBridgeHandle {
  dispose(): void;
}

/**
 * Wire gamepad intents to the structural dispatcher. The bridge consults
 * `isEnabled()` on every event, so callers can gate at runtime without
 * re-binding. Structural-vs-spatial mode is tracked internally by
 * subscribing to the `toggleNavMode` channel.
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
    dispatchAction(view, "nav.in");
  });

  const unsubBack = ch.back.subscribe(() => {
    if (!guard()) return;
    dispatchAction(view, "nav.out");
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
