/**
 * Engine autoplay resume listener.
 *
 * Fulfils (mission feature `m1-autoplay-indicator-and-console`):
 *   VAL-ENGINE-017 — trusted capture-phase keydown resumes suspended audio.
 *   VAL-ENGINE-018 — trusted capture-phase pointerdown resumes suspended
 *                    audio (including clicking the suspended indicator).
 *   VAL-ENGINE-019 — programmatic and non-user triggers (timers, synthetic
 *                    events, gamepad intents, restored code, idle eval)
 *                    do NOT grant activation. Only trusted keydown and
 *                    pointerdown do.
 *
 * Design contract (normative, synthesis.md §6.5):
 *
 *   - `AudioContext.resume()` requires transient user activation in
 *     browsers. Keyboard and pointer events grant it. Gamepad input does
 *     NOT, and neither do timer-driven evals (quantised eval firing on
 *     a bar boundary, live-edit idle auto-eval) nor boot-restored
 *     autosaved programs.
 *
 *   - There is NO dedicated enable-sound action. Once a program contains
 *     synth nodes, ANY activation-carrying interaction — clicking in the
 *     buffer, pressing an eval key, any keydown/pointerdown anywhere in
 *     the app — resumes the engine as a side effect. This module is the
 *     single global listener that attempts resume opportunistically
 *     until it succeeds.
 *
 *   - On rejection the engine stays `suspended` per synthesis.md §6.4;
 *     the suspended indicator's role is to explain, chiefly for
 *     gamepad-only sessions (gamepad input cannot grant activation),
 *     that any click or keypress will enable sound.
 *
 * Trusted-only filter (VAL-ENGINE-019):
 *
 *   - The listener checks `event.isTrusted === true` before calling the
 *     service's resume path. Synthetic events dispatched from script
 *     (e.g. `el.dispatchEvent(new KeyboardEvent('keydown'))`) have
 *     `isTrusted === false` and are silently ignored.
 *
 *   - The listener never subscribes to timers, gamepad input channels,
 *     settings changes, or code-eval events. There is no surface for a
 *     programmatic trigger to slip through. The structural assertion is
 *     testable: only `keydown` and `pointerdown` are registered.
 *
 * Capture phase:
 *
 *   - Both listeners register with `{ capture: true }` so they see
 *     events before any other handler can re-dispatch or swallow them.
 *     The capture phase is also the natural place for a global
 *     opportunistic resume because it does not depend on the target
 *     having any specific wiring.
 *
 * Dependency injection:
 *
 *   - The listener takes a `getActiveSynthesisService` accessor and an
 *     `eventTarget` (defaults to `window.document`). Tests pass fakes.
 *     The listener never imports the audio layer directly; it consumes
 *     the `SynthesisService` shape through the accessor.
 *
 *   - The listener is idempotent: calling `installEngineAutoplayListener`
 *     twice does not double-register listeners. The teardown function
 *     removes the listeners installed by the most recent install.
 */
import { getActiveSynthesisService } from "../runtime/activeSynthesisService";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Minimal event shape the listener consumes. The browser `KeyboardEvent`
 * and `PointerEvent` both satisfy this shape; tests construct it
 * directly so they can control `isTrusted` (which is otherwise
 * immutable from script).
 */
export interface TrustedEventLike {
  readonly type: "keydown" | "pointerdown";
  readonly isTrusted: boolean;
  readonly target: unknown;
  readonly currentTarget: unknown;
  defaultPrevented: boolean;
  preventDefault(): void;
  stopPropagation(): void;
  stopImmediatePropagation(): void;
}

/**
 * EventTarget-like surface the listener registers on. The real
 * `Document` satisfies this shape; tests pass a fake.
 */
export interface EventTargetLike {
  addEventListener(
    type: string,
    listener: (event: TrustedEventLike) => void,
    options?: { capture?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: TrustedEventLike) => void,
    options?: { capture?: boolean },
  ): void;
}

/**
 * Dependencies the listener consumes. All browser globals are injected
 * so tests can run in Node without a window.
 */
export interface EngineAutoplayListenerDependencies {
  /**
   * Accessor that returns the currently active synthesis service, or
   * `null` when audio capability is absent. Defaults to
   * {@link getActiveSynthesisService} from `activeSynthesisService.ts`.
   */
  readonly getActiveSynthesisService?: () =>
    | {
        readonly state: "off" | "suspended" | "running" | "error";
        resumeOnUserActivation(): Promise<boolean>;
      }
    | null;
  /**
   * Return whether the current editor program contains a synth form. Audio
   * bring-up is gated by this predicate so ordinary output visualisation
   * (for example `(a1 bar)`) does not create a suspended AudioContext or
   * steal the local visualisation clock.
   */
  readonly shouldAttemptResume?: () => boolean;
  /**
   * EventTarget to register the capture-phase listeners on. Defaults
   * to `document` in browser environments. Tests pass a fake.
   */
  readonly eventTarget?: EventTargetLike;
}

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

interface InstalledListeners {
  readonly target: EventTargetLike;
  readonly keydown: (event: TrustedEventLike) => void;
  readonly pointerdown: (event: TrustedEventLike) => void;
}

let installed: InstalledListeners | null = null;

// ---------------------------------------------------------------------------
// Listener
// ---------------------------------------------------------------------------

/**
 * Construct the listener closure. Pulled out so tests can call it
 * directly without going through the install machinery.
 *
 * The listener:
 *   1. Rejects untrusted events (VAL-ENGINE-019).
 *   2. Reads the active synthesis service through the accessor.
 *   3. No-ops when no service exists, when the state is `off`, when the
 *      state is `running` (already there), or when the state is `error`
 *      (recovery path owns that).
 *   4. Calls `resumeOnUserActivation()` on `suspended` services.
 */
function makeListener(
  deps: Required<Pick<EngineAutoplayListenerDependencies, "getActiveSynthesisService">> &
    Pick<EngineAutoplayListenerDependencies, "shouldAttemptResume">,
  _eventName: "keydown" | "pointerdown",
): (event: TrustedEventLike) => void {
  return (event: TrustedEventLike) => {
    // VAL-ENGINE-019: synthetic events cannot grant activation.
    if (!event.isTrusted) return;
    if (deps.shouldAttemptResume && !deps.shouldAttemptResume()) return;
    const service = deps.getActiveSynthesisService();
    if (service === null) return;
    // Only the `suspended` state can transition to `running` via
    // user-activation. `off` requires engine bring-up (handled inside
    // resumeOnUserActivation), `error` requires recovery, and
    // `running` is already there.
    //
    // Note: the resume path is opportunistic. Even if the engine is in
    // a fresh `off` state with audio capability, we DO call resume so
    // the service can bring up the AudioContext on the first trusted
    // interaction. The internal state machine handles the off → suspended
    // → running transition atomically.
    if (service.state !== "suspended" && service.state !== "off") {
      return;
    }
    // The service's resume path is async; we do not await it here. The
    // listener must not block the capture-phase event pipeline.
    void service.resumeOnUserActivation();
  };
}

/**
 * Install the global capture-phase keydown and pointerdown listeners.
 *
 * Idempotent: calling this twice is a no-op. The first install wins;
 * the second call returns without registering additional listeners.
 * Tests that need a fresh install should call
 * {@link teardownEngineAutoplayListener} first.
 *
 * In a browser, the default `eventTarget` is `document`. Tests pass a
 * fake `EventTargetLike` so they can dispatch events with controlled
 * `isTrusted` values.
 */
export function installEngineAutoplayListener(
  deps: EngineAutoplayListenerDependencies = {},
): void {
  if (installed !== null) {
    // Idempotent: do not double-register.
    return;
  }
  const getActive = deps.getActiveSynthesisService ?? getActiveSynthesisService;
  const shouldAttemptResume = deps.shouldAttemptResume;
  const target = deps.eventTarget ?? getDefaultEventTarget();
  if (target === null) {
    // Non-browser environment with no injected target: nothing to do.
    return;
  }
  const listenerDeps = {
    getActiveSynthesisService: getActive,
    shouldAttemptResume,
  };
  const keydownListener = makeListener(listenerDeps, "keydown");
  const pointerdownListener = makeListener(listenerDeps, "pointerdown");
  // Capture phase: see events before any other handler can re-dispatch
  // or swallow them. The capture flag is part of the VAL-ENGINE-017/018
  // contract ("real capture-phase keydown/pointerdown").
  target.addEventListener("keydown", keydownListener, { capture: true });
  target.addEventListener("pointerdown", pointerdownListener, { capture: true });
  installed = {
    target,
    keydown: keydownListener,
    pointerdown: pointerdownListener,
  };
}

/**
 * Remove the global listeners installed by
 * {@link installEngineAutoplayListener}. Safe to call when no listener
 * is installed.
 */
export function teardownEngineAutoplayListener(): void {
  if (installed === null) return;
  const { target, keydown, pointerdown } = installed;
  target.removeEventListener("keydown", keydown, { capture: true });
  target.removeEventListener("pointerdown", pointerdown, { capture: true });
  installed = null;
}

/**
 * Read whether the listener is currently installed. Used by tests and
 * by hot-reload wiring that needs to know whether teardown is needed.
 */
export function isEngineAutoplayListenerInstalled(): boolean {
  return installed !== null;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

/**
 * Resolve the default event target. Returns `document` in browser
 * environments and `null` in Node/test environments that do not pass
 * their own target.
 */
function getDefaultEventTarget(): EventTargetLike | null {
  if (typeof document !== "undefined") {
    return document as unknown as EventTargetLike;
  }
  return null;
}
