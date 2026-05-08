/**
 * Property/fuzz tests for the transport state machine.
 *
 * Drives randomized event sequences and asserts machine-level invariants
 * after each event. Cheap to run because the machine is pure (no DOM, no
 * serial, no WASM). Catches regressions where a refactor of the machine
 * shape could leak intermediate / illegal states or context shapes.
 *
 * Seeds default to a fixed list so failures are reproducible. Override via
 * `TRANSPORT_FUZZ_SEEDS=a,b,c` and `TRANSPORT_FUZZ_STEPS=N`.
 */

import { describe, it, expect, vi } from "vitest";
import { createActor } from "xstate";
import { transportMachine } from "./transport.machine.ts";

const LEGAL_STATES = new Set(["playing", "paused", "stopped"]);
const LEGAL_MODES = new Set(["hardware", "wasm", "both", "none"]);

type Event =
  | { type: "PLAY" }
  | { type: "PAUSE" }
  | { type: "STOP" }
  | { type: "REWIND" }
  | { type: "CLEAR" }
  | { type: "SYNC"; state: "playing" | "paused" | "stopped" }
  | { type: "UPDATE_MODE"; mode: "hardware" | "wasm" | "both" | "none" };

function mulberry32(seed: number): () => number {
  let value = seed >>> 0;
  return () => {
    value = (value + 0x6d2b79f5) >>> 0;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rng: () => number, values: readonly T[]): T {
  return values[Math.floor(rng() * values.length)]!;
}

function nextEvent(rng: () => number): Event {
  const roll = rng();
  if (roll < 0.18) return { type: "PLAY" };
  if (roll < 0.35) return { type: "PAUSE" };
  if (roll < 0.50) return { type: "STOP" };
  if (roll < 0.60) return { type: "REWIND" };
  if (roll < 0.68) return { type: "CLEAR" };
  if (roll < 0.85) {
    return {
      type: "SYNC",
      state: pick(rng, ["playing", "paused", "stopped"] as const),
    };
  }
  return {
    type: "UPDATE_MODE",
    mode: pick(rng, ["hardware", "wasm", "both", "none"] as const),
  };
}

function makeActor() {
  const actions = {
    emitPlay: vi.fn(),
    emitPause: vi.fn(),
    emitStop: vi.fn(),
    emitRewind: vi.fn(),
    emitClear: vi.fn(),
    syncWasmPlay: vi.fn(),
    syncWasmPause: vi.fn(),
    syncWasmStop: vi.fn(),
  };
  const machine = transportMachine.provide({ actions });
  const actor = createActor(machine);
  actor.start();
  return actor;
}

function envSeeds(): number[] {
  const raw = process.env.TRANSPORT_FUZZ_SEEDS;
  if (!raw) {
    return [0xdeadbeef, 0xc0ffee, 0x1badd00d, 0xbadc0de];
  }
  return raw
    .split(",")
    .map((s) => Number.parseInt(s.trim(), 16) || Number.parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n));
}

function envSteps(): number {
  const raw = process.env.TRANSPORT_FUZZ_STEPS;
  if (!raw) return 200;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 200;
}

describe("transportMachine fuzz", () => {
  for (const seed of envSeeds()) {
    it(`keeps state and context legal across random events (seed 0x${seed.toString(16)})`, () => {
      const rng = mulberry32(seed);
      const steps = envSteps();
      const actor = makeActor();
      const replay: Event[] = [];

      try {
        for (let step = 0; step < steps; step += 1) {
          const event = nextEvent(rng);
          replay.push(event);
          actor.send(event);

          const snap = actor.getSnapshot();
          const stateValue = String(snap.value);
          expect(
            LEGAL_STATES.has(stateValue),
            `step ${step}: state ${stateValue} not in {playing,paused,stopped}`,
          ).toBe(true);
          expect(
            LEGAL_MODES.has(snap.context.mode),
            `step ${step}: mode ${snap.context.mode} not legal`,
          ).toBe(true);

          // After a SYNC, machine value must equal the synced state.
          if (event.type === "SYNC") {
            expect(stateValue, `step ${step}: SYNC did not converge`).toBe(
              event.state,
            );
          }

          // After UPDATE_MODE, context.mode must match.
          if (event.type === "UPDATE_MODE") {
            expect(
              snap.context.mode,
              `step ${step}: UPDATE_MODE did not apply`,
            ).toBe(event.mode);
          }
        }
      } catch (error) {
        const replayJson = JSON.stringify(replay);
        const wrapped =
          error instanceof Error ? error : new Error(String(error));
        wrapped.message =
          `${wrapped.message}\nseed=0x${seed.toString(16)} replay=${replayJson}`;
        throw wrapped;
      } finally {
        actor.stop();
      }
    });
  }

  // Targeted invariants worth pinning down in addition to the fuzz.
  it("UPDATE_MODE never changes the transport state value", () => {
    const actor = makeActor();
    for (const start of ["playing", "paused", "stopped"] as const) {
      // Drive into the start state.
      if (start === "paused") actor.send({ type: "PAUSE" });
      else if (start === "stopped") actor.send({ type: "STOP" });
      else actor.send({ type: "PLAY" });
      const beforeValue = actor.getSnapshot().value;
      for (const mode of ["hardware", "wasm", "both", "none"] as const) {
        actor.send({ type: "UPDATE_MODE", mode });
        expect(actor.getSnapshot().value).toBe(beforeValue);
      }
    }
    actor.stop();
  });

  it("CLEAR never changes the state value", () => {
    const rng = mulberry32(0xfeedface);
    const actor = makeActor();
    for (let i = 0; i < 50; i += 1) {
      const e = nextEvent(rng);
      if (e.type === "CLEAR") continue;
      actor.send(e);
      const before = actor.getSnapshot().value;
      actor.send({ type: "CLEAR" });
      expect(actor.getSnapshot().value).toBe(before);
    }
    actor.stop();
  });
});
