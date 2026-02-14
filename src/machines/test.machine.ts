// src/machines/test.machine.ts
import { createMachine, assign } from "xstate";

export type TestCtx = { count: number; message?: string };
export type TestEvt =
  | { type: "INCREMENT" }
  | { type: "DECREMENT" }
  | { type: "SET_MESSAGE"; message: string }
  | { type: "RESET" };

export const testMachine = createMachine({
  types: {} as { context: TestCtx; events: TestEvt },
  id: "test",
  initial: "idle",
  context: { count: 0 },
  states: {
    idle: {
      on: {
        INCREMENT: { actions: ["increment"] },
        DECREMENT: { actions: ["decrement"] },
        SET_MESSAGE: { actions: ["setMessage"] },
        RESET: { actions: ["reset"] }
      }
    }
  }
}, {
  actions: {
    increment: assign({
      count: ({ context }) => context.count + 1
    }),
    decrement: assign({
      count: ({ context }) => context.count - 1
    }),
    setMessage: assign({
      message: ({ event }) => (event as any).message
    }),
    reset: assign({
      count: 0,
      message: undefined
    })
  }
});