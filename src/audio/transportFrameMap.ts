/**
 * Pure transport frame→ModuLisp-time mapping contract.
 *
 * Fulfils (see mission feature `m1-audio-clocked-worker-producer`):
 *   VAL-ENGINE-003 — Transport mapping is deterministic across start,
 *                    pause, resume, stop, and re-anchor transitions.
 *   VAL-ENGINE-032 — Transport transitions govern live production
 *                    (start, pause, resume, stop, re-anchor update
 *                    Worker production consistently; paused or stopped
 *                    transport follows declared control behaviour;
 *                    resumed transport re-anchors without stale blocks;
 *                    lookahead remains bounded).
 *
 * Architectural role:
 *
 *   - This module owns the **pure** arithmetic that turns audio frames
 *     into ModuLisp time. It has no side effects, no DOM dependencies,
 *     no Atomics use, and no awareness of the SAB layout. Producers,
 *     tests, and the future re-anchor path consume the same function so
 *     no second transport-time computation ever exists.
 *
 *   - The producer inside the WASM runtime Worker samples upcoming
 *     audio frames through this map. The map is revisioned: every
 *     transition bumps {@link TransportFrameMapSnapshot.revision} so
 *     consumers can correlate transport changes with control blocks.
 *
 *   - The map deliberately mirrors the synthesis spec invariant
 *     (`docs/specs/synthesis.md` §4): the audio frame counter is the
 *     master timeline while audio runs, and transport time is a pure
 *     function of that frame.
 *
 * Semantics:
 *
 *   - `stopped`  — sample() returns the initial time (0). Future
 *                  starts always begin at frame 0 / time 0 unless an
 *                  explicit `atTime` is supplied.
 *   - `paused`   — sample() returns the time captured at the pause,
 *                  regardless of how far the frame counter advanced
 *                  while paused.
 *   - `playing`  — sample() returns `anchorTime + (frame - anchorFrame)
 *                  / sampleRate`.
 *
 *   Re-anchor (`reanchor`) keeps the current transport state but moves
 *   the (anchorFrame, anchorTime) origin. Producers flush already-
 *   published blocks at the next block boundary; the pure map has no
 *   stale-anchor state to leak (VAL-ENGINE-032).
 */
import type { TransportState } from "../machines/transport.machine";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Discriminated transport frame map state. `TransportState` from the
 * transport machine is `"playing" | "paused" | "stopped"`; the pure
 * map mirrors it so callers can correlate directly with xstate.
 */
export type TransportFrameMapState = TransportState;

/**
 * Revision counter. The initial value is `1` (zero is reserved for the
 * "no transport has ever started" sentinel). Every state transition or
 * re-anchor increments the revision by exactly one so consumers can
 * detect a change with `===`.
 */
export const TRANSPORT_FRAME_MAP_REVISION_INITIAL = 1 as const;

/**
 * Frozen snapshot of the mapping state. Used for telemetry, hand-off
 * between producer iterations, and deterministic restoration in tests.
 */
export interface TransportFrameMapSnapshot {
  /** Schema version of the snapshot shape. */
  readonly schemaVersion: number;
  /** Current transport state. */
  readonly state: TransportFrameMapState;
  /** Audio frame at the most recent anchor (start, resume, re-anchor). */
  readonly anchorFrame: bigint;
  /** ModuLisp time at the most recent anchor. */
  readonly anchorTime: number;
  /** Sample rate the map was constructed with (frames per second). */
  readonly sampleRate: number;
  /**
   * Monotonic revision counter. Bumped on every transition or re-anchor.
   * Consumers can detect a transport change with strict equality.
   */
  readonly revision: number;
}

/** Schema version of the snapshot shape. Bumped only when fields change. */
export const TRANSPORT_FRAME_MAP_SCHEMA_VERSION = 1 as const;

/**
 * Argument shape for transitions that move the anchor (start, pause,
 * resume, re-anchor). `atFrame` is mandatory; `atTime` defaults to the
 * time the map would have produced at `atFrame` for transitions that
 * preserve time (resume, re-anchor).
 */
export interface TransportFrameMapTransitionOptions {
  /** Audio frame at which the transition takes effect. */
  readonly atFrame: bigint;
  /**
   * ModuLisp time at the transition frame. Required for `start` and
   * `pause`; optional for `resume` and `reanchor` (defaults to the
   * current ModuLisp time at `atFrame`).
   */
  readonly atTime?: number;
}

/**
 * Argument for {@link TransportFrameMap.lookaheadFrame} — computes the
 * frame the producer should publish into for the i'th future block.
 */
export interface TransportFrameMapLookaheadOptions {
  /** Frame at the start of the block being produced right now. */
  readonly fromFrame: bigint;
  /** Number of blocks to look ahead. */
  readonly blockCount: number;
  /** Render quantum in frames per block. */
  readonly renderQuantumFrames: number;
}

/**
 * Constructor options. `initialState` is `"stopped"` by default.
 */
export interface TransportFrameMapOptions {
  /** Sample rate in frames per second. Must be a positive finite number. */
  readonly sampleRate: number;
  /** Initial transport state. Defaults to `"stopped"`. */
  readonly initialState?: TransportFrameMapState;
  /** Initial anchor frame. Defaults to `0n`. */
  readonly initialAnchorFrame?: bigint;
  /** Initial anchor time. Defaults to `0`. */
  readonly initialAnchorTime?: number;
  /** Initial revision. Defaults to {@link TRANSPORT_FRAME_MAP_REVISION_INITIAL}. */
  readonly initialRevision?: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class TransportFrameMapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransportFrameMapError";
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TransportFrameMapError(`${label} must be a finite number, got ${value}`);
  }
}

function assertSampleRate(sampleRate: number): void {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) {
    throw new TransportFrameMapError(
      `sampleRate must be a positive finite number, got ${sampleRate}`,
    );
  }
}

function assertAtFrame(atFrame: bigint): void {
  if (typeof atFrame !== "bigint" || atFrame < 0n) {
    throw new TransportFrameMapError(
      `atFrame must be a non-negative bigint, got ${atFrame.toString()}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

/**
 * Pure transport frame→time map. All methods are pure with respect to
 * external state; only the internal {@link TransportFrameMapState} and
 * revision change.
 *
 * Construct via {@link createTransportFrameMap}.
 */
export interface TransportFrameMap {
  /** Current transport state. */
  state(): TransportFrameMapState;
  /** Current sample rate. */
  sampleRate(): number;
  /** Current anchor frame. */
  anchorFrame(): bigint;
  /** Current anchor ModuLisp time. */
  anchorTime(): number;
  /** Current revision counter. */
  revision(): number;

  /**
   * Sample the ModuLisp time at the given audio frame. Pure: returns
   * the same value for the same `(frame, current state)` pair.
   *
   * @param frame Audio frame counter (must be `>= anchorFrame` while
   *              playing; otherwise any non-negative bigint is accepted).
   */
  sample(frame: bigint): number;

  /**
   * Compute the audio frame `blockCount` blocks ahead of `fromFrame`.
   * The returned frame is the *start* of the lookahead window's last
   * block.
   */
  lookaheadFrame(options: TransportFrameMapLookaheadOptions): bigint;

  /**
   * Start transport at the given frame and time. Replaces any prior
   * state. Bumps the revision.
   */
  start(options: TransportFrameMapTransitionOptions): void;

  /**
   * Pause transport, freezing ModuLisp time at the supplied frame/time.
   * Bumps the revision. No-op if already paused.
   */
  pause(options: TransportFrameMapTransitionOptions): void;

  /**
   * Resume transport from a paused state. Re-anchors at the given
   * frame and the supplied (or current) ModuLisp time. Bumps the
   * revision. No-op if already playing.
   */
  resume(options: TransportFrameMapTransitionOptions): void;

  /**
   * Stop transport. The map returns to the initial state on the next
   * `start`. Bumps the revision. No-op if already stopped.
   */
  stop(options: Pick<TransportFrameMapTransitionOptions, "atFrame">): void;

  /**
   * Re-anchor the map without changing the transport state. Useful for
   * drift correction or sample-rate hand-off. Bumps the revision.
   */
  reanchor(options: TransportFrameMapTransitionOptions): void;

  /**
   * Publish a frozen snapshot of the mapping state. The snapshot is
   * safe to share with telemetry consumers and to restore on a fresh
   * map via {@link restore}.
   */
  snapshot(): TransportFrameMapSnapshot;

  /**
   * Restore the mapping state from a snapshot. The revision is taken
   * from the snapshot; subsequent transitions continue from there.
   */
  restore(snapshot: TransportFrameMapSnapshot): void;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a transport frame→time map.
 *
 * The factory does not perform any I/O. The resulting map is safe to
 * use inside the WASM runtime Worker, on the main thread, and in tests.
 */
export function createTransportFrameMap(
  options: TransportFrameMapOptions,
): TransportFrameMap {
  const sampleRate = options.sampleRate;
  assertSampleRate(sampleRate);

  let currentState: TransportFrameMapState = options.initialState ?? "stopped";
  let anchorFrame = options.initialAnchorFrame ?? 0n;
  let anchorTime = options.initialAnchorTime ?? 0;
  let revision = options.initialRevision ?? TRANSPORT_FRAME_MAP_REVISION_INITIAL;

  if ((options.initialAnchorTime ?? 0) !== 0) {
    assertFiniteNumber(options.initialAnchorTime ?? 0, "initialAnchorTime");
  }

  function sampleAt(frame: bigint, state: TransportFrameMapState): number {
    if (state === "stopped") return 0;
    if (state === "paused") return anchorTime;
    // playing
    if (frame < anchorFrame) {
      // Defensive: producers should not pass frames earlier than the
      // anchor. Clamp to the anchor time so the result is finite.
      return anchorTime;
    }
    const deltaFrames = Number(frame - anchorFrame);
    return anchorTime + deltaFrames / sampleRate;
  }

  function bumpRevision(): void {
    revision += 1;
  }

  function setAnchor(atFrame: bigint, atTime: number): void {
    anchorFrame = atFrame;
    anchorTime = atTime;
  }

  return {
    state: () => currentState,
    sampleRate: () => sampleRate,
    anchorFrame: () => anchorFrame,
    anchorTime: () => anchorTime,
    revision: () => revision,

    sample(frame: bigint): number {
      assertAtFrame(frame);
      return sampleAt(frame, currentState);
    },

    lookaheadFrame(o): bigint {
      if (!Number.isInteger(o.blockCount) || o.blockCount < 0) {
        throw new TransportFrameMapError(
          `blockCount must be a non-negative integer, got ${o.blockCount}`,
        );
      }
      if (!Number.isInteger(o.renderQuantumFrames) || o.renderQuantumFrames <= 0) {
        throw new TransportFrameMapError(
          `renderQuantumFrames must be a positive integer, got ${o.renderQuantumFrames}`,
        );
      }
      return o.fromFrame + BigInt(o.blockCount * o.renderQuantumFrames);
    },

    start(o): void {
      assertAtFrame(o.atFrame);
      const t = o.atTime ?? 0;
      assertFiniteNumber(t, "start.atTime");
      currentState = "playing";
      setAnchor(o.atFrame, t);
      bumpRevision();
    },

    pause(o): void {
      if (currentState === "paused") return;
      assertAtFrame(o.atFrame);
      const t = o.atTime ?? sampleAt(o.atFrame, currentState);
      assertFiniteNumber(t, "pause.atTime");
      currentState = "paused";
      setAnchor(o.atFrame, t);
      bumpRevision();
    },

    resume(o): void {
      if (currentState === "playing") return;
      assertAtFrame(o.atFrame);
      const t = o.atTime ?? anchorTime;
      assertFiniteNumber(t, "resume.atTime");
      currentState = "playing";
      setAnchor(o.atFrame, t);
      bumpRevision();
    },

    stop(o): void {
      if (currentState === "stopped") return;
      assertAtFrame(o.atFrame);
      currentState = "stopped";
      setAnchor(o.atFrame, 0);
      bumpRevision();
    },

    reanchor(o): void {
      assertAtFrame(o.atFrame);
      const t = o.atTime ?? sampleAt(o.atFrame, currentState);
      assertFiniteNumber(t, "reanchor.atTime");
      setAnchor(o.atFrame, t);
      bumpRevision();
    },

    snapshot(): TransportFrameMapSnapshot {
      return Object.freeze({
        schemaVersion: TRANSPORT_FRAME_MAP_SCHEMA_VERSION,
        state: currentState,
        anchorFrame,
        anchorTime,
        sampleRate,
        revision,
      });
    },

    restore(snap): void {
      if (snap.schemaVersion !== TRANSPORT_FRAME_MAP_SCHEMA_VERSION) {
        throw new TransportFrameMapError(
          `snapshot schema ${snap.schemaVersion} does not match ${TRANSPORT_FRAME_MAP_SCHEMA_VERSION}`,
        );
      }
      assertSampleRate(snap.sampleRate);
      currentState = snap.state;
      anchorFrame = snap.anchorFrame;
      anchorTime = snap.anchorTime;
      revision = snap.revision;
    },
  };
}
