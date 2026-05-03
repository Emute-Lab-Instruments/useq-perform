/**
 * Hardware binding dispatcher (gii8.57).
 *
 * Subscribes to the hardware input channel and dispatches bound expressions
 * to the runtime for evaluation when a matching binding exists in the
 * editor document.
 *
 * Spec: docs/specs/hardware-bindings.md
 *   §4.1 — eval dispatch (lookup + submit as top-level eval)
 *   §4.2 — edge detection (client-side, from hardware channel)
 *   §4.3 — re-trigger queue (per-binding FIFO, coalesced hold ticks)
 *   §4.5 — error semantics (LKG, per-binding, non-blocking)
 *   §4.6 — runtime disconnect (drain to console warning, discard)
 *
 * This module follows the effect-module pattern: a `createHardwareBindingDispatcher()`
 * factory returns a disposable handle. The caller (bootstrap or app lifecycle)
 * starts it once after the editor and WASM runtime are available.
 *
 * Import boundary: `src/effects/` must not import from `src/editors/`.
 * Chip widget integration (pushing chip state, wiring test-fire) is
 * injected via the `DispatcherConfig` callbacks so the adapter layer
 * in `src/runtime/` can bridge the two.
 */

import { hwInput } from "../contracts/hardwareChannels.ts";
import type { HwInputEvent } from "../contracts/hardware.ts";
import type { BindingEventKind, BindingChip } from "../contracts/hardware.ts";
import { getActiveWasmRuntimePort } from "../runtime/activeWasmRuntimePort.ts";
import { getAppSettings } from "../runtime/appSettingsRepository.ts";
import { editor } from "../lib/editorStore.ts";
import { post } from "../utils/consoleStore.ts";
import { sendTouSEQ } from "../transport/json-protocol.ts";
import { getStartupFlagsSnapshot } from "../runtime/startupContext.ts";

// ---------------------------------------------------------------------------
// Config (dependency injection for editor-layer integration)
// ---------------------------------------------------------------------------

/**
 * Callbacks injected by the caller to bridge the dispatcher (effects layer)
 * with the chip widget (editors layer) without violating import boundaries.
 */
export interface DispatcherConfig {
  /**
   * Push chip state to the editor's chip widget extension.
   * Called after every event dispatch and on initial sync.
   */
  syncChips(chips: BindingChip[]): void;
  /**
   * Register a callback that fires when the user clicks a chip (test-fire).
   * The dispatcher will call `publish` on the hardware channel to simulate
   * the hardware event, which then goes through the normal dispatch path.
   * Pass `null` to unregister.
   */
  setFireCallback(cb: ((chip: BindingChip) => void) | null): void;
}

// ---------------------------------------------------------------------------
// Binding form scanning
// ---------------------------------------------------------------------------

/**
 * Parsed binding found in the editor document.
 */
interface ParsedBinding {
  /** e.g. "on-press", "on-release", "on-button", "on-toggle" */
  event: BindingEventKind;
  /** Input keyword WITH leading colon, e.g. ":sw1" */
  inputId: string;
  /** The body expression text (everything after the input-id keyword). */
  body: string;
  /** Document range of the entire wrapper form. */
  from: number;
  to: number;
}

/**
 * Regex that matches the four binding wrapper forms at the start of a
 * balanced parenthesized expression. We capture the event name and input-id;
 * the body is extracted by balanced-paren walking.
 */
const BINDING_HEAD_RE =
  /\(\s*(on-press|on-release|on-button|on-toggle)\s+(:[a-z][a-z0-9]*)\s+/g;

/**
 * Scan the document text for all binding forms.
 *
 * This is a lightweight text-level scan (not a full Lezer parse) because:
 *   - Binding forms have a rigid `(on-X :id body)` shape.
 *   - The scan runs on every hardware event (needs to be fast).
 *   - It only needs to find the body text and range, not a full AST.
 *
 * Limitation: does not validate nesting depth or top-level-only (§2.8).
 * The compiler/diagnostics layer handles that separately.
 */
export function scanBindings(docText: string): ParsedBinding[] {
  const bindings: ParsedBinding[] = [];
  BINDING_HEAD_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = BINDING_HEAD_RE.exec(docText)) !== null) {
    const formStart = match.index;
    const event = match[1] as BindingEventKind;
    const inputId = match[2]!;
    const bodyStart = formStart + match[0].length;

    // Walk forward to find the matching closing paren for the wrapper form.
    let depth = 1; // We're inside the opening paren already.
    let i = bodyStart;
    while (i < docText.length && depth > 0) {
      const ch = docText[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      // Skip string literals to avoid false paren matches.
      else if (ch === '"') {
        i++;
        while (i < docText.length && docText[i] !== '"') {
          if (docText[i] === "\\") i++; // skip escaped char
          i++;
        }
        // i now points at the closing quote (or past end).
        // Don't increment here — the outer i++ will advance past it.
        continue;
      }
      i++;
    }

    if (depth !== 0) continue; // Unbalanced — skip.

    const formEnd = i; // Points one past the closing paren.
    const body = docText.slice(bodyStart, formEnd - 1).trim(); // Exclude closing paren.

    bindings.push({
      event,
      inputId,
      body,
      from: formStart,
      to: formEnd,
    });
  }

  return bindings;
}

// ---------------------------------------------------------------------------
// Per-binding eval queue (§4.3)
// ---------------------------------------------------------------------------

interface BindingQueue {
  /** Currently in-flight eval promise (null if idle). */
  inflight: Promise<void> | null;
  /** FIFO of pending expressions to eval. */
  pending: string[];
  /** For on-button hold coalescing: pending hold ms (null if none). */
  pendingHoldMs: number | null;
  /** Drop counter for the current 1-second window. */
  dropCount: number;
  /** Timestamp of the last drop-warning emission. */
  lastDropWarnMs: number;
}

/** Key is `${event}:${inputId}`, e.g. `on-press::sw1`. */
const queues = new Map<string, BindingQueue>();

function getQueue(key: string): BindingQueue {
  let q = queues.get(key);
  if (!q) {
    q = {
      inflight: null,
      pending: [],
      pendingHoldMs: null,
      dropCount: 0,
      lastDropWarnMs: 0,
    };
    queues.set(key, q);
  }
  return q;
}

function queueKey(event: BindingEventKind, inputId: string): string {
  return `${event}:${inputId}`;
}

// ---------------------------------------------------------------------------
// Eval dispatch
// ---------------------------------------------------------------------------

/** Last fire timestamp per binding key — drives chip pulse animation. */
const lastFireMs = new Map<string, number>();
/** Last phase per binding key — drives on-button lifecycle indicator. */
const lastPhase = new Map<string, "press" | "hold" | "release">();
/** Last error per binding key — drives chip error state. */
const lastError = new Map<string, string | undefined>();

/**
 * Evaluate a bound expression. Returns a promise that resolves when the
 * eval completes (success or failure). Errors are surfaced as console
 * warnings and stored per-binding — they do not throw.
 */
async function evalBinding(
  code: string,
  key: string,
  inputId: string,
): Promise<void> {
  const noModuleMode = getStartupFlagsSnapshot().noModuleMode;

  try {
    const result = await getActiveWasmRuntimePort().evalCode(code);
    const diagnostics = await getActiveWasmRuntimePort().readLastDiagnostics();
    const hasErrors = diagnostics.some((d) => d.severity === "error");

    if (hasErrors && diagnostics.length > 0) {
      const msg = diagnostics[0]!.message;
      lastError.set(key, msg);
      console.warn(`[hw-binding] ${inputId} eval error: ${msg}`);
    } else {
      // Clear error on successful fire.
      lastError.delete(key);
    }

    // Also send to hardware if not in no-module mode.
    if (!noModuleMode) {
      sendTouSEQ("@" + code);
    }

    if (result != null) {
      const trimmed = (typeof result === "string" ? result : String(result)).trim();
      if (trimmed.length > 0) {
        console.log(`[hw-binding] ${inputId} → ${trimmed}`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    lastError.set(key, msg);
    console.warn(`[hw-binding] ${inputId} eval failed: ${msg}`);
  }
}

/**
 * Submit an expression through the per-binding queue. Respects queue depth
 * and coalescing rules from §4.3.
 */
function submitToQueue(
  event: BindingEventKind,
  inputId: string,
  code: string,
  phase?: "press" | "hold" | "release",
): void {
  const key = queueKey(event, inputId);
  const q = getQueue(key);
  const settings = getAppSettings();
  const maxDepth = settings.hardware?.bindingQueueDepth ?? 4;

  // Record fire timestamp and phase for chip animation.
  lastFireMs.set(key, performance.now());
  if (phase) lastPhase.set(key, phase);

  // Hold-phase coalescing (§4.3): if a hold eval is in-flight, just
  // update the pending ms rather than queueing another.
  if (phase === "hold" && q.inflight) {
    q.pendingHoldMs = performance.now();
    // Replace any pending hold entries with the new one.
    const nonHoldPending = q.pending.filter(
      (c) => !c.includes(":hold"),
    );
    if (nonHoldPending.length < maxDepth) {
      nonHoldPending.push(code);
      q.pending = nonHoldPending;
    }
    return;
  }

  const drain = () => {
    if (q.pending.length === 0) {
      q.inflight = null;
      return;
    }
    const next = q.pending.shift()!;
    q.inflight = evalBinding(next, key, inputId).then(drain);
  };

  if (!q.inflight) {
    // No eval in flight — fire immediately.
    q.inflight = evalBinding(code, key, inputId).then(drain);
  } else if (q.pending.length < maxDepth) {
    q.pending.push(code);
  } else {
    // Queue full — drop with console warning (§4.3).
    q.dropCount++;
    const now = performance.now();
    if (now - q.lastDropWarnMs > 1000) {
      const count = q.dropCount;
      q.dropCount = 0;
      q.lastDropWarnMs = now;
      post(
        `binding ${inputId} dropped ${count} event${count > 1 ? "s" : ""}: queue full (depth ${maxDepth})`,
        "warn",
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Chip state building (no editor imports — caller pushes via config)
// ---------------------------------------------------------------------------

/**
 * Build the BindingChip array from parsed bindings and current fire state.
 */
function buildChipData(bindings: ParsedBinding[]): BindingChip[] {
  const settings = getAppSettings();
  const disabled = !(settings.hardware?.bindingsEnabled ?? true);

  return bindings.map((b) => {
    const key = queueKey(b.event, b.inputId);
    const inputKind = inferInputKind(b.inputId, b.event);
    return {
      inputId: b.inputId,
      inputKind,
      event: b.event,
      range: { from: b.from, to: b.to },
      lastFireMs: lastFireMs.get(key) ?? 0,
      lastPhase: lastPhase.get(key),
      error: lastError.get(key),
      disabled,
    };
  });
}

function inferInputKind(
  inputId: string,
  event: BindingEventKind,
): "switch" | "toggle" | "encoder-click" | "gate" {
  const bare = inputId.startsWith(":") ? inputId.slice(1) : inputId;
  if (bare === "swr") return "encoder-click";
  if (bare.startsWith("in")) return "gate";
  if (event === "on-toggle") return "toggle";
  return "switch";
}

// ---------------------------------------------------------------------------
// Event → binding dispatch
// ---------------------------------------------------------------------------

/**
 * Map a hardware input event to the matching binding event kind(s).
 *
 * A single hardware event can match multiple binding forms:
 *   - A "pressed" button matches `on-press` AND `on-button` (with phase :press).
 *   - A "released" button matches `on-release` AND `on-button` (with phase :release).
 *   - A toggle state change matches `on-toggle`.
 */
function matchEvent(
  hwEvent: HwInputEvent,
): Array<{ event: BindingEventKind; phase?: "press" | "hold" | "release" }> {
  if (hwEvent.kind === "toggle") {
    return [{ event: "on-toggle" }];
  }

  // button / encoder / gate — all use pressed/released edges
  const matches: Array<{
    event: BindingEventKind;
    phase?: "press" | "hold" | "release";
  }> = [];

  if (hwEvent.state === "pressed") {
    matches.push({ event: "on-press" });
    matches.push({ event: "on-button", phase: "press" });
  } else if (hwEvent.state === "released") {
    matches.push({ event: "on-release" });
    matches.push({ event: "on-button", phase: "release" });
  }

  return matches;
}

/**
 * Build the eval code for a binding fire.
 *
 * For simple edge handlers (on-press, on-release), the body is evaluated
 * directly. For lifecycle handlers (on-button), we wrap the call with the
 * phase keyword and ms value. For toggle handlers, we pass the boolean state.
 */
function buildEvalCode(
  binding: ParsedBinding,
  phase?: "press" | "hold" | "release",
  ms?: number,
  toggleState?: boolean,
): string {
  switch (binding.event) {
    case "on-press":
    case "on-release":
      // Body is evaluated directly for side effects.
      return binding.body;

    case "on-button": {
      // Body is a (lambda (phase ms) ...) — call it with the phase keyword and ms.
      const phaseKw = phase ? `:${phase}` : ":press";
      const msVal = ms ?? 0;
      return `(${binding.body} ${phaseKw} ${msVal})`;
    }

    case "on-toggle": {
      // Body is a (lambda (state) ...) — call it with the boolean state.
      const stateVal = toggleState ? "1" : "0";
      return `(${binding.body} ${stateVal})`;
    }
  }
}

/**
 * Core event handler. Scans the document, finds matching bindings,
 * dispatches evals. Calls config.syncChips to update the visual surface.
 */
function createEventHandler(config: DispatcherConfig) {
  return function handleHardwareEvent(hwEvent: HwInputEvent): void {
    const settings = getAppSettings();
    if (!(settings.hardware?.bindingsEnabled ?? true)) return;

    const view = editor();
    if (!view) return;

    const docText = view.state.doc.toString();
    const bindings = scanBindings(docText);

    // Sync chips regardless of whether there's a match — keeps the visual
    // surface up to date.
    config.syncChips(buildChipData(bindings));

    // The hardware event carries the id without colon; bindings use `:id`.
    const inputIdWithColon = `:${hwEvent.id}`;

    const matchedEvents = matchEvent(hwEvent);
    let anyMatched = false;

    for (const { event, phase } of matchedEvents) {
      const binding = bindings.find(
        (b) => b.event === event && b.inputId === inputIdWithColon,
      );
      if (!binding) continue;

      anyMatched = true;
      const ms = hwEvent.ts ?? 0;
      const code = buildEvalCode(
        binding,
        phase,
        ms,
        typeof hwEvent.state === "boolean" ? hwEvent.state : undefined,
      );
      submitToQueue(event, inputIdWithColon, code, phase);
    }

    if (!anyMatched) {
      console.debug(`[hw-binding] unbound: ${hwEvent.kind} ${hwEvent.id} (${hwEvent.state})`);
    }

    // Re-sync chips after fire timestamps were updated.
    config.syncChips(buildChipData(bindings));
  };
}

// ---------------------------------------------------------------------------
// Hold tick loop (§4.3 / §6.4)
// ---------------------------------------------------------------------------

/**
 * Track active press gestures for on-button lifecycle hold ticks.
 *
 * Key: inputId with colon (e.g. ":sw1")
 * Value: { pressTimestamp, intervalId }
 */
interface ActiveHold {
  pressMs: number;
  intervalId: ReturnType<typeof setInterval>;
}

const activeHolds = new Map<string, ActiveHold>();

function startHoldTicks(
  inputId: string,
  binding: ParsedBinding,
  config: DispatcherConfig,
): void {
  const settings = getAppSettings();
  const hz = settings.hardware?.holdTickHz ?? 30;
  const intervalMs = Math.max(16, Math.round(1000 / hz));
  const pressMs = performance.now();

  const intervalId = setInterval(() => {
    const elapsed = performance.now() - pressMs;
    const code = buildEvalCode(binding, "hold", elapsed);
    submitToQueue("on-button", inputId, code, "hold");

    // Sync chips for the hold phase indicator.
    const view = editor();
    if (view) {
      const docText = view.state.doc.toString();
      config.syncChips(buildChipData(scanBindings(docText)));
    }
  }, intervalMs);

  activeHolds.set(inputId, { pressMs, intervalId });
}

function stopHoldTicks(inputId: string): void {
  const hold = activeHolds.get(inputId);
  if (hold) {
    clearInterval(hold.intervalId);
    activeHolds.delete(inputId);
  }
}

// ---------------------------------------------------------------------------
// Public API — factory
// ---------------------------------------------------------------------------

export interface HardwareBindingDispatcherHandle {
  /** Stop the dispatcher and clean up subscriptions. */
  dispose(): void;
}

/**
 * Create and start the hardware binding dispatcher.
 *
 * Subscribes to the hardware input channel and dispatches bound expressions.
 * Returns a handle with a `dispose()` method for cleanup.
 *
 * @param config — callbacks for editor integration (chip sync, test-fire).
 *   The caller in `appLifecycle.ts` bridges the editor and effects layers.
 *
 * Should be called once after the editor and WASM runtime are available
 * (typically from bootstrap or app lifecycle).
 */
export function createHardwareBindingDispatcher(
  config: DispatcherConfig,
): HardwareBindingDispatcherHandle {
  const handleEvent = createEventHandler(config);

  // Extended handler that manages hold tick lifecycle.
  function handleHardwareEventWithHold(hwEvent: HwInputEvent): void {
    const inputIdWithColon = `:${hwEvent.id}`;

    // Manage hold tick lifecycle for on-button bindings.
    if (hwEvent.state === "pressed") {
      const view = editor();
      if (view) {
        const docText = view.state.doc.toString();
        const bindings = scanBindings(docText);
        const onButtonBinding = bindings.find(
          (b) => b.event === "on-button" && b.inputId === inputIdWithColon,
        );
        if (onButtonBinding) {
          startHoldTicks(inputIdWithColon, onButtonBinding, config);
        }
      }
    } else if (hwEvent.state === "released") {
      stopHoldTicks(inputIdWithColon);
    }

    handleEvent(hwEvent);
  }

  // Subscribe to hardware input events.
  const unsubHwInput = hwInput.subscribe(handleHardwareEventWithHold);

  // Wire the test-fire callback (§5).
  config.setFireCallback((chip) => {
    const settings = getAppSettings();
    if (!(settings.hardware?.bindingsEnabled ?? true)) return;

    // Simulate a press event for the chip's input.
    const bareId = chip.inputId.startsWith(":")
      ? chip.inputId.slice(1)
      : chip.inputId;

    if (chip.event === "on-toggle") {
      hwInput.publish({
        kind: "toggle",
        id: bareId,
        state: true, // Virtual toggle latch — always flips to true on click.
        ts: performance.now(),
      });
    } else {
      // Simulate press + release for edge bindings.
      hwInput.publish({
        kind: "button",
        id: bareId,
        state: "pressed",
        ts: performance.now(),
      });
      // Immediate release for tap gesture.
      setTimeout(() => {
        hwInput.publish({
          kind: "button",
          id: bareId,
          state: "released",
          ts: performance.now(),
        });
      }, 50);
    }
  });

  // Do an initial chip sync from the current document.
  const view = editor();
  if (view) {
    const docText = view.state.doc.toString();
    const bindings = scanBindings(docText);
    config.syncChips(buildChipData(bindings));
  }

  return {
    dispose() {
      unsubHwInput();
      config.setFireCallback(null);

      // Clear all hold tick intervals.
      for (const [, hold] of activeHolds) {
        clearInterval(hold.intervalId);
      }
      activeHolds.clear();

      // Clear queue state.
      queues.clear();
      lastFireMs.clear();
      lastPhase.clear();
      lastError.clear();
    },
  };
}
