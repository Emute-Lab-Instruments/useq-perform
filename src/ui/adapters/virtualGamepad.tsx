import XboxController from "../virtualGamepad/XboxController";
import { createSolidAdapter } from "./createSolidAdapter";

const adapter = createSolidAdapter({
  containerId: "virtual-gamepad-root",
  containerStyle: {
    position: "fixed",
    bottom: "16px",
    right: "16px",
    width: "400px",
    zIndex: "9999",
    opacity: "0.85",
    pointerEvents: "auto",
  },
  Component: () => <XboxController />,
});

export function mountVirtualGamepad(root?: HTMLElement): void {
  adapter.mount(root);
}
