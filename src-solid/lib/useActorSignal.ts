// lib/useActorSignal.ts
import { Accessor, createSignal, onCleanup } from "solid-js";
import type { AnyActorRef } from "xstate";

export function useActorSignal<T extends AnyActorRef>(actor: T): {
  state: Accessor<ReturnType<T["getSnapshot"]>>,
  send: T["send"]
} {
  const [state, set] = createSignal(actor.getSnapshot());
  const sub = actor.subscribe(set);
  onCleanup(() => sub.unsubscribe?.());
  return { state, send: actor.send };
}