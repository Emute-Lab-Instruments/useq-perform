// src-solid/effects/test.ts
import { Effect } from "effect";

export class TestError {
  readonly _tag = "TestError";
  constructor(readonly message: string) {}
}

export const delayedMessage = (message: string, delayMs: number = 1000) =>
  Effect.tryPromise({
    try: async () => {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      return `Delayed: ${message}`;
    },
    catch: (e) => new TestError(e instanceof Error ? e.message : String(e))
  });