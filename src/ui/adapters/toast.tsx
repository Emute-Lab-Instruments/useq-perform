/**
 * Toast adapter — wires `toastChannel` to the pure ToastStack view.
 *
 * The store subscribes at module load (the application root imports this
 * module at startup), so `notify()` calls from any layer are captured.
 */
import { toastChannel } from "../../contracts/toastChannels";
import { ToastStack } from "../toast/ToastStack";
import { createToastStore } from "../toast/toastStore";

export const toastStore = createToastStore();

toastChannel.subscribe((event) => toastStore.add(event));

export function ToastRoot() {
  return (
    <ToastStack
      toasts={toastStore.toasts()}
      onDismiss={toastStore.dismiss}
      onAction={toastStore.runAction}
    />
  );
}
