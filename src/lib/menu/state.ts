// src/lib/menu/state.ts
//
// Pure state-machine reducer for the radial menu (the centre-screen,
// double-ring, gamepad-driven content picker specified by
// docs/specs/radial-menu.md).
//
// Signature: `reduce(state: MenuState, input: MenuInput): MenuState`.
//
// PURE. No `Date.now()`, no `Math.random()`, no module-level mutable state,
// no async, no DOM, no gamepad / Solid imports. Every (state-kind × input-
// kind) pair returns a new state; no-op combinations return the same
// reference unchanged. Exhaustiveness is enforced by `assertNever` in the
// inner switches.
//
// Verb application is NOT done here. When a face button fires in `frozen`,
// the reducer transitions to `closed`; the dispatcher reads the pre-reduce
// `Open` state (with its `frozen` snapshot) to derive the verb intent and
// invoke `verbs.apply(...)` separately. See §13.x note below.
//
// References to spec sections are to docs/specs/radial-menu.md.

import { assertNever } from "../gamepad/types";
import type {
  ApplyTarget,
  FrozenSnapshot,
  Manifest,
  MenuInput,
  MenuState,
  MenuStateClosed,
  MenuStateNumpad,
  MenuStateOpen,
  MenuStateT9,
  OpenSubPhase,
  ShoulderHeld,
  ShoulderSide,
  StickHover,
  Verb,
} from "./types";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

/**
 * The reducer's initial state — menu closed, no apply target captured. The
 * dispatcher transitions from this to an `open` state by feeding an
 * `MenuInput` of kind `'open'` carrying the apply target and active manifest
 * (§3.1.1, §3.1.3).
 *
 * @see docs/specs/radial-menu.md §2.4
 */
export const INITIAL_STATE: MenuState = { phase: "closed" };

// ---------------------------------------------------------------------------
// Sub-phase derivation (spec §2.4)
// ---------------------------------------------------------------------------

/**
 * Compute the open-state sub-phase from `(leftHover, rightHover, frozen)`.
 *
 * The four sub-phases are *derived* — they are not a stored field. The
 * renderer and dispatcher call this to decide LB/RB roles (§3.3) and to
 * gate the freeze trigger (§3.3.3).
 *
 * @see docs/specs/radial-menu.md §2.4
 */
export function subPhase(state: MenuStateOpen): OpenSubPhase {
  if (state.frozen !== null) return "frozen";
  if (state.leftHover === null && state.rightHover === null) {
    return "cyclingLeftTabs";
  }
  if (state.leftHover !== null && state.rightHover === null) {
    return "cyclingRightTabs";
  }
  return "picking";
}

// ---------------------------------------------------------------------------
// Internal helpers — pure constructors / mod helpers
// ---------------------------------------------------------------------------

/**
 * Modulo that handles negative dividends correctly (JavaScript's `%` keeps
 * sign of dividend; we want a non-negative remainder for tab-index
 * cycling).
 */
function mod(n: number, m: number): number {
  if (m <= 0) return 0;
  return ((n % m) + m) % m;
}

/**
 * Number of categories on the current left tab (used as the tab-cycle
 * modulus for the *left* tabs, since LB/RB cycle the *tab*, not the
 * category). Spec §6.1 transitions: `tap(LB) ─→ open(t-1 mod N, …)` where
 * N is the number of left tabs.
 */
function leftTabCount(manifest: Manifest): number {
  return manifest.tabs.length;
}

/**
 * Number of right tabs declared on the currently-active left tab. If the
 * active left tab declares no `rightTabs`, the modulus is 1 (only the
 * implicit unfiltered view exists) — cycling becomes a no-op via mod 1.
 *
 * @see docs/specs/radial-menu.md §4.2
 */
function rightTabCount(manifest: Manifest, leftTabIdx: number): number {
  const tab = manifest.tabs[leftTabIdx];
  if (!tab) return 1;
  const rt = tab.rightTabs;
  if (!rt || rt.length === 0) return 1;
  return rt.length;
}

/**
 * Build a fresh `MenuStateOpen` for `'open'` input. Per §3.1.2: starts at
 * `(leftTabIdx=0, rightTabIdx=0, leftHover=null, rightHover=null,
 * shoulderHeld='none', frozen=null)`.
 */
function freshOpen(target: ApplyTarget, manifest: Manifest): MenuStateOpen {
  return {
    phase: "open",
    leftTabIdx: 0,
    rightTabIdx: 0,
    leftHover: null,
    rightHover: null,
    shoulderHeld: "none",
    frozen: null,
    target,
    manifest,
  };
}

/**
 * Reset the open state's hovers when a left-tab cycle occurs (per §4.1.3:
 * "When a left tab is cycled, the right tab index resets to 0 for the new
 * tab. Hovers (leftHover, rightHover) are already null by virtue of being
 * in cyclingLeftTabs.").
 *
 * Tab cycling can only fire from `cyclingLeftTabs` so hovers are
 * structurally null already — but we set them explicitly to make the
 * transition self-evident and survive any future spec relaxation.
 */
function withLeftTabCycle(
  state: MenuStateOpen,
  newLeftTabIdx: number,
): MenuStateOpen {
  return {
    ...state,
    leftTabIdx: newLeftTabIdx,
    rightTabIdx: 0,
    leftHover: null,
    rightHover: null,
    shoulderHeld: "none",
    frozen: null,
  };
}

/**
 * Apply a right-tab cycle. Per §4.2.3: items repopulate; right hover stays
 * null (right stick is centred in `cyclingRightTabs`).
 */
function withRightTabCycle(
  state: MenuStateOpen,
  newRightTabIdx: number,
): MenuStateOpen {
  return {
    ...state,
    rightTabIdx: newRightTabIdx,
    rightHover: null,
  };
}

// ---------------------------------------------------------------------------
// Shoulder bookkeeping (spec §3.3, §3.3.4, §6.2.5)
// ---------------------------------------------------------------------------

/**
 * Compute the new `shoulderHeld` value after an edge event.
 *
 * Press semantics:
 * - `none` + press(left)  → `left`
 * - `none` + press(right) → `right`
 * - `left` + press(right) → `both`
 * - `right` + press(left) → `both`
 * - `*`    + press(both)  → `both` (coalesced edge per §6.2.5)
 *
 * Release semantics:
 * - `left`  + release(left)  → `none`
 * - `right` + release(right) → `none`
 * - `both`  + release(left)  → `right`
 * - `both`  + release(right) → `left`
 * - `*`     + release(both)  → `none` (coalesced; equivalent to releasing
 *                              both shoulders simultaneously)
 *
 * Mismatched releases (e.g. release(left) when held is 'right') are
 * structurally impossible if the dispatcher tracks edges correctly — but
 * we degrade gracefully by leaving the state unchanged.
 *
 * @see docs/specs/radial-menu.md §3.3
 * @see docs/specs/radial-menu.md §6.2.5
 */
function applyShoulderEdge(
  current: ShoulderHeld,
  side: ShoulderSide,
  transition: "press" | "release",
): ShoulderHeld {
  if (transition === "press") {
    if (side === "both") return "both";
    if (current === "none") return side;
    if (current === side) return side; // already held; idempotent
    // current is the other side → both pressed
    return "both";
  }
  // release
  if (side === "both") return "none";
  if (current === side) return "none";
  if (current === "both") return side === "left" ? "right" : "left";
  // releasing a side that isn't held — leave unchanged
  return current;
}

// ---------------------------------------------------------------------------
// Frozen-snapshot bookkeeping (spec §3.3.2, §3.3.3)
// ---------------------------------------------------------------------------

/**
 * Resolve the current hovers into concrete IDs to capture as a
 * `FrozenSnapshot`. Returns `null` if either hover is missing (no
 * categories or no items at the hovered indices), which signals "freeze
 * not possible — drop the press silently".
 *
 * Per §3.3.3 the dispatcher is supposed to suppress the freeze trigger
 * when either hover is null — but the manifest can also have an empty
 * category (§6.2.1), and this guards against that as well.
 *
 * @see docs/specs/radial-menu.md §3.3.2
 * @see docs/specs/radial-menu.md §3.3.3
 * @see docs/specs/radial-menu.md §6.2.1
 */
function snapshotFromHovers(state: MenuStateOpen): FrozenSnapshot | null {
  if (state.leftHover === null || state.rightHover === null) return null;
  const tab = state.manifest.tabs[state.leftTabIdx];
  if (!tab) return null;
  const category = tab.categories[state.leftHover];
  if (!category) return null;
  const item = category.items[state.rightHover];
  if (!item) return null;
  return {
    leftTabIdx: state.leftTabIdx,
    leftPicked: category.id,
    rightTabIdx: state.rightTabIdx,
    rightPicked: item.id,
  };
}

// ---------------------------------------------------------------------------
// Reducer — closed state
// ---------------------------------------------------------------------------

function reduceClosed(state: MenuStateClosed, input: MenuInput): MenuState {
  switch (input.kind) {
    case "open":
      return freshOpen(input.target, input.manifest);

    // Every other input is a no-op while closed — gamepad input is masked
    // by the radial layer's `when` predicate (spec §11.3) so these only
    // arrive in pathological cases (e.g. a stuck-at-released event posted
    // after close). Drop them silently.
    case "axisLeft":
    case "axisRight":
    case "tabCycle":
    case "shoulderEdge":
    case "face":
    case "trigger":
    case "back":
    case "cancel":
    case "subModeOpen":
    case "subModeAppend":
    case "subModeBackspace":
    case "subModeCommitAndContinue":
    case "subModeCommitAndExit":
    case "subModeT9Cycle":
    case "subModeT9IdleCommit":
      return state;

    default:
      return assertNever(input);
  }
}

// ---------------------------------------------------------------------------
// Reducer — open state
// ---------------------------------------------------------------------------

function reduceOpen(state: MenuStateOpen, input: MenuInput): MenuState {
  switch (input.kind) {
    // ---- re-open: collapse to a fresh open ---------------------------------
    case "open":
      // A second `open` while already open is treated as a re-open with new
      // target / manifest (auto-chain re-opens this way per §8.2).
      return freshOpen(input.target, input.manifest);

    // ---- live stick tracking ----------------------------------------------
    case "axisLeft": {
      // Live tracking is suppressed when frozen (§3.3 table: "ignored"
      // when frozen). The frozen snapshot is the source of truth until
      // released.
      if (state.frozen !== null) return state;
      return updateHover(state, "left", input.hover);
    }

    case "axisRight": {
      if (state.frozen !== null) return state;
      return updateHover(state, "right", input.hover);
    }

    // ---- tab cycling (sub-phase-gated) ------------------------------------
    case "tabCycle": {
      const phase = subPhase(state);
      if (input.side === "left") {
        // LB/RB cycle left tabs only in cyclingLeftTabs (§3.3 table).
        if (phase !== "cyclingLeftTabs") return state;
        const n = leftTabCount(state.manifest);
        if (n <= 0) return state;
        return withLeftTabCycle(state, mod(state.leftTabIdx + input.dir, n));
      }
      // side === 'right' — cycle right tabs only in cyclingRightTabs.
      if (phase !== "cyclingRightTabs") return state;
      const m = rightTabCount(state.manifest, state.leftTabIdx);
      if (m <= 0) return state;
      return withRightTabCycle(state, mod(state.rightTabIdx + input.dir, m));
    }

    // ---- shoulder edges ---------------------------------------------------
    case "shoulderEdge": {
      const newHeld = applyShoulderEdge(
        state.shoulderHeld,
        input.side,
        input.transition,
      );

      // Press semantics depend on current sub-phase.
      if (input.transition === "press") {
        const phase = subPhase(state);
        // §3.3.4: a press during cyclingLeftTabs / cyclingRightTabs does
        // not enter freeze even if the user later engages the missing
        // stick — the press is "owned" by the sub-phase it began in. We
        // realise this by simply not capturing a frozen snapshot unless
        // the current sub-phase is `picking`.
        if (phase === "picking") {
          // §3.3.3: freeze requires both hovers. snapshotFromHovers
          // returns null otherwise, in which case we still update
          // shoulderHeld (so a subsequent release-balanced bookkeeping
          // works) but do not enter frozen.
          const snap = snapshotFromHovers(state);
          if (snap !== null) {
            return { ...state, shoulderHeld: newHeld, frozen: snap };
          }
        }
        // Any other sub-phase: just record the press; sub-phase remains
        // unchanged.
        return { ...state, shoulderHeld: newHeld };
      }

      // release: if we're currently frozen and the release brings
      // shoulderHeld to 'none', drop the snapshot and resume picking
      // (§3.3.2: "Releasing all shoulders without a face press returns to
      // picking — frozen cleared; live hovers resume tracking the
      // sticks.").
      if (state.frozen !== null && newHeld === "none") {
        return { ...state, shoulderHeld: newHeld, frozen: null };
      }
      // Otherwise: just update bookkeeping. Spec is silent on what happens
      // when one of two held shoulders is released mid-frozen (e.g. user
      // had 'both' and released LB → 'right'). Simpler answer: keep the
      // frozen snapshot and update `shoulderHeld` so the next face press
      // fires with the still-held side's hand. This matches the user's
      // mental model: "the snapshot is what I picked; releasing one
      // shoulder just changes which hand fires."
      // @see radial-menu.md §3.3.2 — release-all is the only documented
      //   transition; one-of-two-released is undefined; the simpler
      //   answer keeps the latched pick alive.
      return { ...state, shoulderHeld: newHeld };
    }

    // ---- face buttons -----------------------------------------------------
    case "face": {
      // §3.3 table: face buttons are no-ops outside `frozen`. In `frozen`
      // they fire the verb and close the menu. The dispatcher reads the
      // pre-reduce open state (target, frozen snapshot, shoulderHeld) to
      // derive the verb intent before applying this reducer step.
      // @see radial-menu.md §6.1 — "face(F) when sub-phase=frozen → closed;
      //   dispatch verb(F, sh)". MenuStateClosed has no slot for the
      //   intent, so the reducer's job is purely the state transition;
      //   verb dispatch is handled out-of-band by the dispatcher
      //   (Track E reads frozen + shoulderHeld + target before reducing).
      if (state.frozen === null) return state;
      return { phase: "closed" };
    }

    // ---- trigger pagination -----------------------------------------------
    case "trigger": {
      // §4.4: LT/RT paginate the right ring. v1 page-index state is not
      // tracked in MenuStateOpen (the manifest doesn't yet pass
      // pagination through), so the reducer treats trigger as a no-op
      // here. Pagination will be added when the renderer needs it.
      // @see radial-menu.md §4.4 — pagination state model is deferred.
      return state;
    }

    // ---- close paths ------------------------------------------------------
    case "back": {
      // §3.3 table:
      //   - in `frozen`: clear snapshot + return to picking
      //   - elsewhere: close the menu.
      if (state.frozen !== null) {
        return { ...state, shoulderHeld: "none", frozen: null };
      }
      return { phase: "closed" };
    }

    case "cancel":
      // Explicit close (gamepad disconnect, keyboard Esc — §12.4, §12.6).
      return { phase: "closed" };

    // ---- sub-mode entry ---------------------------------------------------
    case "subModeOpen": {
      // §14.1.3: manual entry from the picking phase via the synthetic
      // `Type number` / `Type new symbol` items. The mode and active verb
      // are carried on the input; `returnTo` defaults to 'open' here
      // because we *are* in open. The dispatcher may also issue
      // subModeOpen with returnTo: 'closed' for auto-chain entry from a
      // post-commit closed state — handled in `reduceClosed` indirectly
      // (auto-chain re-opens via 'open' first; sub-mode is then entered).
      if (input.mode === "numpad") {
        const next: MenuStateNumpad = {
          phase: "numpad",
          buffer: "",
          target: input.target,
          returnTo: input.returnTo,
          activeVerb: input.activeVerb,
        };
        return next;
      }
      const next: MenuStateT9 = {
        phase: "t9",
        buffer: "",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: input.target,
        returnTo: input.returnTo,
        activeVerb: input.activeVerb,
      };
      return next;
    }

    // ---- sub-mode-only inputs are no-ops in open state --------------------
    case "subModeAppend":
    case "subModeBackspace":
    case "subModeCommitAndContinue":
    case "subModeCommitAndExit":
    case "subModeT9Cycle":
    case "subModeT9IdleCommit":
      return state;

    default:
      return assertNever(input);
  }
}

/**
 * Apply a single-stick hover update. Encapsulates the "right hover snaps
 * to null when left hover goes to null" rule that §4.3.2 implies — once
 * the left stick is centred we are back in `cyclingLeftTabs` so any prior
 * right hover is structurally invalidated. Spec is mostly silent on this
 * but the simplest answer (cascade clear) keeps sub-phase derivation
 * monotonic.
 *
 * @see radial-menu.md §4.3.2 — sub-phases follow stick state directly.
 */
function updateHover(
  state: MenuStateOpen,
  side: "left" | "right",
  hover: StickHover,
): MenuStateOpen {
  if (side === "left") {
    if (hover === null) {
      // Left stick centred → drop right hover too so we land in
      // `cyclingLeftTabs` (per the sub-phase derivation table).
      if (state.leftHover === null && state.rightHover === null) return state;
      return { ...state, leftHover: null, rightHover: null };
    }
    if (state.leftHover === hover) return state;
    return { ...state, leftHover: hover };
  }
  // right
  if (state.rightHover === hover) return state;
  return { ...state, rightHover: hover };
}

// ---------------------------------------------------------------------------
// Reducer — numpad sub-mode (spec §14.2 / §14.3)
// ---------------------------------------------------------------------------

function reduceNumpad(state: MenuStateNumpad, input: MenuInput): MenuState {
  switch (input.kind) {
    // ---- buffer mutation --------------------------------------------------
    case "subModeAppend":
      return { ...state, buffer: state.buffer + input.char };

    case "subModeBackspace":
      if (state.buffer.length === 0) return state;
      return { ...state, buffer: state.buffer.slice(0, -1) };

    // ---- commit paths -----------------------------------------------------
    case "subModeCommitAndContinue":
      // §14.3: face X commits buffer + clears for a fresh value, staying
      // in numpad. The dispatcher applies the buffer-as-node mutation and
      // advances the apply target *before* this reducer step; here we
      // just clear the buffer.
      // @see radial-menu.md §14.3.3 — apply target advances; the new
      //   target arrives via subModeOpen if the dispatcher chooses to
      //   re-issue it. For simplicity the reducer keeps the same target
      //   and lets the dispatcher's mutation step capture the new
      //   structural cursor; the reducer just clears the buffer.
      if (state.buffer.length === 0) return state;
      return { ...state, buffer: "" };

    case "subModeCommitAndExit":
      // §14.3 face B / Start / outer-✓: commit (if non-empty) + return to
      // `returnTo`. The reducer transitions; the dispatcher reads the
      // pre-reduce buffer to perform the commit.
      return state.returnTo === "closed"
        ? { phase: "closed" }
        : reopenSentinel(state);

    // ---- explicit close ---------------------------------------------------
    case "back":
      // §14.3 Back: cancel — buffer discarded, return to `returnTo`.
      return state.returnTo === "closed"
        ? { phase: "closed" }
        : reopenSentinel(state);

    case "cancel":
      // §14.6.1: gamepad disconnect mid-entry behaves like Back.
      return { phase: "closed" };

    // ---- re-open / sub-mode entry while already in numpad ------------------
    case "open":
      // A fresh open replaces sub-mode wholesale (auto-chain triggered
      // mid-buffer is unlikely but defined: drop the buffer, open clean).
      return freshOpen(input.target, input.manifest);

    case "subModeOpen": {
      // Switching sub-mode mid-buffer: discard the current buffer and
      // open the new sub-mode at the supplied target. Spec doesn't
      // explicitly cover this; simpler answer is to honour the dispatcher's
      // request rather than no-op.
      // @see radial-menu.md §14.1.3 — manual sub-mode entry; cross-mode
      //   switch is undefined.
      if (input.mode === "numpad") {
        return {
          ...state,
          buffer: "",
          target: input.target,
          returnTo: input.returnTo,
          activeVerb: input.activeVerb,
        };
      }
      const next: MenuStateT9 = {
        phase: "t9",
        buffer: "",
        lastKey: null,
        lastKeyAt: 0,
        caseMode: "lower",
        target: input.target,
        returnTo: input.returnTo,
        activeVerb: input.activeVerb,
      };
      return next;
    }

    // ---- inputs the numpad does not consume -------------------------------
    case "axisLeft":
    case "axisRight":
    case "tabCycle":
    case "shoulderEdge":
    case "face":
    case "trigger":
    case "subModeT9Cycle":
    case "subModeT9IdleCommit":
      return state;

    default:
      return assertNever(input);
  }
}

// ---------------------------------------------------------------------------
// Reducer — T9 sub-mode (spec §14.4)
// ---------------------------------------------------------------------------

function reduceT9(state: MenuStateT9, input: MenuInput): MenuState {
  switch (input.kind) {
    // ---- multi-tap cycling ------------------------------------------------
    case "subModeT9Cycle": {
      // §14.4.1: multi-tap commits when the user moves the stick to a
      // different position and presses A there. The reducer captures the
      // *cycle* — the dispatcher computed the next character at the
      // current key position based on lastKey + lastKeyAt + the multi-tap
      // table. The buffer's pending tail (if any) is replaced by the new
      // character; the dispatcher signals "different key, commit pending"
      // by sending `subModeT9IdleCommit` first.
      //
      // Our model: the *most recent* T9 cycle's character is appended to
      // the buffer at cycle-time, and subsequent cycles at the same key
      // *replace* that trailing character. When `lastKey` changes, the
      // pending tail is committed (frozen in place) and the new
      // character is appended fresh.
      //
      // @see radial-menu.md §14.4.1 — multi-tap commit timing.
      const sameKey = state.lastKey === input.key;
      const pendingTail = state.lastKey !== null;
      let buffer = state.buffer;
      if (sameKey && pendingTail) {
        // Replace the trailing pending character with the new one. The
        // dispatcher passes the *target character* via a separate path —
        // here we don't have it (the input only carries `key` + `ts`).
        // The simpler answer: the dispatcher sends `subModeAppend(char)`
        // for both first-tap and replacement-tap, and `subModeT9Cycle`
        // is purely a notification that updates lastKey/lastKeyAt for
        // idle-commit timing. So this case is just bookkeeping.
        // @see radial-menu.md §14.4 — character cycling logic owned by
        //   the dispatcher; reducer tracks timing state only.
        buffer = state.buffer; // unchanged
      } else if (!sameKey && pendingTail) {
        // Different key while a tail is pending: the pending tail commits
        // implicitly (dispatcher will issue the actual append for the
        // new key separately). Bookkeeping-only here.
        buffer = state.buffer;
      }
      return {
        ...state,
        buffer,
        lastKey: input.key,
        lastKeyAt: input.ts,
      };
    }

    case "subModeT9IdleCommit":
      // §14.4.1: 600 ms idle since lastKey commits the pending tail. The
      // dispatcher already wrote the character into the buffer via
      // subModeAppend; the reducer's job is to clear lastKey so the next
      // cycle starts fresh.
      return { ...state, lastKey: null, lastKeyAt: input.ts };

    // ---- buffer mutation (same as numpad) --------------------------------
    case "subModeAppend":
      return { ...state, buffer: state.buffer + input.char };

    case "subModeBackspace":
      if (state.buffer.length === 0) return state;
      return {
        ...state,
        buffer: state.buffer.slice(0, -1),
        lastKey: null,
      };

    case "subModeCommitAndContinue":
      if (state.buffer.length === 0) return state;
      return { ...state, buffer: "", lastKey: null };

    case "subModeCommitAndExit":
      return state.returnTo === "closed"
        ? { phase: "closed" }
        : reopenSentinel(state);

    case "back":
      return state.returnTo === "closed"
        ? { phase: "closed" }
        : reopenSentinel(state);

    case "cancel":
      return { phase: "closed" };

    case "open":
      return freshOpen(input.target, input.manifest);

    case "subModeOpen": {
      if (input.mode === "t9") {
        return {
          ...state,
          buffer: "",
          lastKey: null,
          lastKeyAt: 0,
          target: input.target,
          returnTo: input.returnTo,
          activeVerb: input.activeVerb,
        };
      }
      const next: MenuStateNumpad = {
        phase: "numpad",
        buffer: "",
        target: input.target,
        returnTo: input.returnTo,
        activeVerb: input.activeVerb,
      };
      return next;
    }

    // ---- inputs the t9 sub-mode does not consume -------------------------
    case "axisLeft":
    case "axisRight":
    case "tabCycle":
    case "shoulderEdge":
    case "face":
    case "trigger":
      return state;

    default:
      return assertNever(input);
  }
}

/**
 * Sub-mode → 'open' return path. Spec §14.3 / §14.4 say the user returns
 * to `returnTo` after commit/back; if `returnTo === 'open'` the menu's
 * pre-sub-mode open state should be restored.
 *
 * Tension: this types-only state machine does not store the parent open
 * state. The simpler answer chosen here is to return to a *fresh open*
 * with the sub-mode's `target` + a sentinel manifest reference. The
 * dispatcher will recognise the transition and either restore the
 * captured pre-sub-mode open state directly, or re-issue an `open` input
 * with the correct manifest.
 *
 * @see radial-menu.md §14.1 — sub-modes are siblings of `'open'`, not
 *   children; how the parent open state is restored is under-specified.
 *   The dispatcher owns the parent-snapshot.
 */
function reopenSentinel(state: MenuStateNumpad | MenuStateT9): MenuState {
  // We do not have a Manifest in the sub-mode state, so we cannot
  // construct a real MenuStateOpen. Returning `closed` is incorrect for
  // returnTo === 'open' but is the only structurally sound option. The
  // dispatcher must recognise this transition and re-issue an `open`
  // input. Documented as a known interaction with the dispatcher track.
  void state;
  return { phase: "closed" };
}

// ---------------------------------------------------------------------------
// Reducer — top-level dispatch
// ---------------------------------------------------------------------------

/**
 * Pure menu state reducer. Total over `(state.phase × input.kind)`.
 *
 * @see docs/specs/radial-menu.md §6.1
 */
export function reduce(state: MenuState, input: MenuInput): MenuState {
  switch (state.phase) {
    case "closed":
      return reduceClosed(state, input);
    case "open":
      return reduceOpen(state, input);
    case "numpad":
      return reduceNumpad(state, input);
    case "t9":
      return reduceT9(state, input);
    default:
      return assertNever(state);
  }
}
