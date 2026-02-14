// lib/effectResource.ts
import { createResource } from "solid-js";
import { Effect } from "effect";

export const effectResource = <A>(eff: Effect.Effect<A, unknown, never>) =>
  createResource(() => Effect.runPromise(eff));