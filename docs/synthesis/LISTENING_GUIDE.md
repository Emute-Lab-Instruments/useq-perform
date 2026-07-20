---
stability: stable
layer: behavioural
audience: user
---

# First-Sound Listening Guide (Synthesis Engine M1)

> **Path:** `docs/synthesis/LISTENING_GUIDE.md`
>
> This is the user-run, subjective listening checklist for the
> `osc/sine` first-sound slice of the synthesis engine. It is paired
> with the **objective** devmode telemetry checks the automated
> validators already run; subjective audibility is **not** claimed by
> automation. You (the user) must execute the steps below and judge
> audibility, pitch movement, click-free re-eval, and glitch behaviour
> with your own ears.

---

## 0. Read this before you put headphones on

### ⚠️ Safe-volume warning

- **Start with your interface / headphone volume at the LOWEST setting
  before the first eval.** A pure 440 Hz sine at amplitude 0.2 peaks at
  -14 dBFS, which is already loud through sensitive headphones.
- Use speakers if possible for the first run. If you must use
  headphones, set the volume to the quietest level at which you can
  still hear system sounds, then evaluate.
- **Turn the volume down before every reload or `terminateProducer`
  recovery step.** Those steps can re-emit a full-scale sine at the
  default amplitude.
- If you hear any discomfort, click the synthesis engine indicator
  (Suspended / Error) or close the browser tab immediately.

### ⏹ Immediate stop conditions

Use any one of these to silence the engine:

1. **Click the synthesis engine indicator** (top transport area). When
   the engine is `running` the indicator is the small dot labelled
   `Running` in the transport-family indicator cluster; clicking it
   suspends the AudioContext.
2. **Close the tab** — the AudioContext is torn down by the browser.
3. **Reload the page** — reload tears down the AudioContext and the
   document is restored without auto-resume (the engine re-enters the
   `suspended` state).
4. **Trigger producer timeout** in devmode (see §6 below) — the worklet
   independently fades to exact silence over 10 ms and the engine
   enters `error`. This is the safest automated stop because it does
   not require main-thread responsiveness.

The engine can never drone indefinitely: the worklet enforces a
`PRODUCER_TIMEOUT_BLOCKS` (24-block, ~64 ms) liveness check and fades
to exact zero over 10 ms after timeout detection.

---

## 1. Exact setup (port 5000 + devmode)

### 1.1 Start the static server on port 5000

From the repository root:

```sh
npm run build
npm run start
```

`npm run start` runs `serve public -p 5000 --cors --config serve.json`
and prints something like:

```
INFO: Serving "public" at http://localhost:5000
```

Open **`http://127.0.0.1:5000/`** in Chromium (or any browser with
AudioWorklet and SharedArrayBuffer support). The page must be served
from `127.0.0.1:5000` exactly — the static server emits the COOP /
COEP headers required for `crossOriginIsolated` to become `true` and
for `SharedArrayBuffer` to be available. (See `vite.config.ts` and
`public/serve.json` for the header configuration; `same-origin` +
`credentialless` is required.)

### 1.2 Enable devmode

Append `?devmode=true` to the URL (strict string equality —
`?devmode=1` does **not** enable devmode):

```
http://127.0.0.1:5000/?devmode=true
```

In devmode the synthesis service installs the read-only global
`window.__useqSynthesisDev`, which exposes:

- `getTelemetry()` — returns the latest frozen telemetry snapshot;
- `terminateProducer()` — controlled fault action (see §6);
- `reinitialise()` — recovery affordance (see §6).

These actions are **absent or inert outside devmode**. The objective
browser-flow validator (`m1-objective-first-sound-browser-flow`) drives
the same surface; you will reproduce a subset of its checks by hand.

### 1.3 Reachable controls in the browser

| Control                                | How to reach it                                                                          | Devmode-only? |
| -------------------------------------- | ---------------------------------------------------------------------------------------- | ------------- |
| Code editor                            | Main editor pane on first visit.                                                         | No            |
| Eval key (`Mod-Enter`)                 | Cursor inside the editor, press `Mod-Enter` (Cmd-Enter on macOS, Ctrl-Enter elsewhere).  | No            |
| Transport toolbar                      | Top toolbar area, transport-family indicator cluster.                                    | No            |
| Synthesis engine indicator             | Transport-family indicator cluster (next to the transport controls).                     | No            |
| `__useqSynthesisDev.getTelemetry()`    | Browser devtools console, devmode only.                                                  | **Yes**       |
| `__useqSynthesisDev.terminateProducer()` | Browser devtools console, devmode only.                                                | **Yes**       |
| `__useqSynthesisDev.reinitialise()`    | Browser devtools console, devmode only.                                                  | **Yes**       |

### 1.4 Pre-flight telemetry check (objective)

Open devtools and run:

```js
__useqSynthesisDev.getTelemetry()
```

You should see a frozen object with:

- `capabilities.crossOriginIsolated === true`
- `capabilities.sharedArrayBuffer === true`
- `capabilities.audioWorklet === true`
- `capabilities.worker === true`
- `capabilities.sharedWebAssemblyMemory === true`
- `capabilities.audioCapable === true`
- `engineState === "off"` or `"suspended"`
- `sabAbiVersion === <number>` (matches `ABI_VERSION` in
  `src/contracts/synthesisControlAbi.ts`)

If any capability is `false`, do **not** proceed: the synthesis engine
will stay in `off` and you will hear nothing. See the capability
diagnostic in the editor for the missing requirement.

---

## 2. First sound

### Source

Type this single form into the editor:

```lisp
(synth "osc/sine" :freq 440)
```

### Actions

1. With headphones at **low volume**, place the cursor on the line and
   press `Mod-Enter` to evaluate the form. The exact-eval response is
   atomic: diagnostics, compiler revision, patch graph, and control
   table all arrive in one Worker response.
2. The synthesis engine transitions `off → suspended` and the
   transport-family indicator shows a **Suspended** chip with a tooltip
   like `Audio is suspended. Click the indicator or press any key to
   enable sound.`
3. Click the **Suspended** indicator (or press any key) to grant
   transient user activation. The engine transitions
   `suspended → running` and the indicator becomes **Running**.

### Expected subjective observations

- After clicking the indicator you hear a **steady 440 Hz sine tone**
  at the registry default amplitude (0.2). The tone fades in over
  ~10 ms (`SYNTH_FADE_IN`) rather than clicking on.
- The tone is continuous, not buzzy, and stays at a stable pitch.

### Objective checks (devtools console)

```js
const t = __useqSynthesisDev.getTelemetry();
// engineState === "running"
// audioContextState === "running"
// programRevision > 0
// activeEpoch > 0
// pendingEpoch === 0
// instanceId !== ""           // stable identity of the active osc/sine
// audioFrame > 0n             // audio thread has produced at least one block
// peakSample > 0              // finite non-zero destination output
// rmsSample > 0
// finiteOutput === 1
// timeoutCount === 0          // no producer fault yet
```

The engine creates **exactly one AudioWorkletNode** for the graph
(`workletNodeCount === 1`). Confirm with the telemetry snapshot.

---

## 3. Pitch movement on the same anonymous synth

### Source

Edit the line in place to change the frequency:

```lisp
(synth "osc/sine" :freq 660)
```

### Actions

Re-evaluate with `Mod-Enter`. The editor preserves the persistent
hidden sidecar identity of the anonymous synth form across the edit.

### Expected subjective observations

- The pitch moves from A4 (440 Hz) to E5 (660 Hz) **smoothly, with no
  click or pop** at the transition. The DSP instance is preserved on
  the same-def update (no phase reset, no fade-out / fade-in).

### Objective checks

```js
const t = __useqSynthesisDev.getTelemetry();
// instanceId is UNCHANGED from §2 (update-in-place, not re-instantiate)
// activeEpoch === <same epoch or one higher after the eval commit>
// peakSample > 0
// finiteOutput === 1
```

The DSP phase counter advances continuously across the parameter
change (the worklet's phase continuity invariant).

---

## 4. Click-free repeated re-evaluation

### Source

Keep the same `(synth "osc/sine" :freq 660)` line.

### Actions

Press `Mod-Enter` repeatedly, ~once per second, 8–10 times in a row.
Each eval is the same source and the same identity, so the engine
treats every commit as an update-in-place.

### Expected subjective observations

- The tone continues uninterrupted. No clicks, pops, or amplitude
  dips. The DSP instance and its phase are preserved across every
  commit.

### Objective checks

```js
const t = __useqSynthesisDev.getTelemetry();
// instanceId UNCHANGED across all 10 evals
// transitionCount is unchanged while the engine stays "running"
// underrunCount === 0   // no ring underrun introduced by eval pressure
// glitchCount === 0     // no render deadline miss
// timeoutCount === 0
// finiteOutput === 1
```

---

## 5. Panel / menu / drag stress

### Actions

While the engine is `running` and the 660 Hz tone is sounding, perform
the following 10-second stress sequence:

1. Open and close the settings panel 20 times (gear icon).
2. Open and close the help / reference panel 20 times.
3. Drag the visualisation panel dock 20 times (small drag is fine).
4. Type and evaluate 10 trivial edits in the editor (e.g. toggle
   `660` ↔ `661`).

### Expected subjective observations

- The tone is **uninterrupted** for the full 10 seconds. No clicks,
  pops, dropouts, or pitch wobble. The audio thread is decoupled from
  the UI thread.

### Objective checks

```js
const t = __useqSynthesisDev.getTelemetry();
// engineState === "running"     // no error transition
// audioFrame keeps advancing monotonically
// finiteOutput === 1
// underrunCount === 0           // no underrun introduced by UI stress
// glitchCount === 0             // no deadline miss
// timeoutCount === 0
// peakSample > 0                // output stayed live throughout
```

---

## 6. Producer death, bounded 10 ms fade, error, and recovery

This step intentionally kills the control producer. You will hear a
brief 10 ms fade to silence followed by no further sound.

### Actions

1. In devtools, run:
   ```js
   __useqSynthesisDev.terminateProducer()
   ```
   This is a devmode-only controlled fault action. It returns `true`
   when the termination signal was sent.
2. Wait ~64 ms (one `PRODUCER_TIMEOUT_BLOCKS` window of 24 blocks at
   the active render quantum). The worklet detects producer loss
   **independently** of any main-thread error notification.

### Expected subjective observations

- The tone **fades to silence over ~10 ms** (the separate
  `EMERGENCY_FADE_MS = 10` emergency-fade constant, distinct from
  `SYNTH_FADE_OUT_MS = 30` for instance-retirement fades) and then stays
  silent. No indefinite drone.
- The transport-family synthesis indicator transitions from
  `Running` to **Error**, and a console message is posted:
  `Synthesis engine: PRODUCER_TIMEOUT. Output has been faded to silence.`

### Objective checks

```js
const t = __useqSynthesisDev.getTelemetry();
// engineState === "error"
// reasonKey === "PRODUCER_TIMEOUT"   // (via the engine lifecycle channel)
// peakSample === 0
// rmsSample === 0
// finiteOutput === 1
// timeoutCount > 0                    // incremented by exactly one
// producerTimeoutActive === true      // during the fade; may relax later
// audioFrame stops advancing         // worklet muted the destination
```

### Recovery

1. In devtools, run:
   ```js
   await __useqSynthesisDev.reinitialise()
   ```
   This disposes the failed Worker + worklet and constructs a fresh
   service instance. Failed resources are prevented from publishing
   again; exactly one new Worker and one new AudioWorkletNode are
   constructed (VAL-ENGINE-027).
2. The engine transitions `error → suspended`. The synthesis indicator
   becomes **Suspended**.
3. Click the **Suspended** indicator (or press any key) to resume.
4. The engine transitions `suspended → running` and the 660 Hz tone
   returns with a fade-in.

### Objective checks after recovery

```js
const t = __useqSynthesisDev.getTelemetry();
// engineState === "running"
// audioContextState === "running"
// workletNodeCount === 1            // single new worklet node
// compiledModuleCount === 1         // osc/sine re-compiled once
// instanceId !== ""                 // fresh instance after recovery
// peakSample > 0                    // finite non-zero output again
// rmsSample > 0
// finiteOutput === 1
// timeoutCount is unchanged from §6 (no second fault)
```

---

## 7. Reload and autoplay

### Actions

1. With the engine `running` and the tone audible, press the browser
   reload button (or `Cmd-R` / `Ctrl-R`).
2. The document (including the persistent sidecar identity) is
   restored from `localStorage`. The synth form recompiles on load.
3. The engine transitions back to `suspended` on reload. It does
   **not** auto-resume: programmatic reload cannot grant transient
   user activation.
4. Click anywhere in the editor, or click the **Suspended**
   indicator. The engine resumes and the tone returns.

### Expected subjective observations

- After reload there is **no sound** until your click or keypress. The
  tone that returns is the same synth form, the same identity (the
  persistent sidecar survives reload), and the same pitch.
- A short (~10 ms) fade-in plays when the engine resumes.

### Objective checks

```js
// Immediately after reload, before any click:
const t1 = __useqSynthesisDev.getTelemetry();
// engineState === "suspended"
// audioContextState === "suspended" or null
// instanceId !== ""                   // identity restored from storage

// After clicking the suspended indicator:
const t2 = __useqSynthesisDev.getTelemetry();
// engineState === "running"
// audioContextState === "running"
// peakSample > 0
```

---

## 8. Map of named controls to source surfaces

Every control named above is reachable in the browser. The objective
browser-flow validator confirms reachability with real
`agent-browser` interactions. The table below is the static map for
maintainers.

| Guide reference                          | Implementation surface                                                                                            |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Synthesis engine indicator (chip / dot)  | `src/audio/engineIndicator.tsx` — `<EngineIndicator />`, `data-engine-state`, `engine-indicator-clickable` class. |
| Indicator mounting (transport cluster)   | `src/ui/adapters/toolbars.tsx` — `mountEngineIndicator()` called from bootstrap.                                  |
| Clickable suspended / error recovery     | `EngineIndicator` `onClick` → `onResume` → `service.resumeOnUserActivation()`.                                    |
| Devmode telemetry surface                | `SynthesisDevmodeSurface` in `src/audio/synthesisService.ts`; `createSynthesisDevmodeSurface()`.                  |
| `terminateProducer()` / `reinitialise()` | Methods on `SynthesisDevmodeSurface`; installed on `window.__useqSynthesisDev` only when devmode is on.           |
| Devmode URL flag                         | `src/runtime/startupContext.ts` — `readStartupFlags()` (`devmode` strict-equals `"true"`).                        |
| Canonical sine source                    | `(synth "osc/sine" :freq 440)` — registry entry `OSC_SINE_NODEDEF_DESCRIPTOR` in `src/contracts/nodeDefRegistry.ts`. |
| Static port-5000 hosting                 | `npm run start` → `serve public -p 5000 --cors --config serve.json`; COOP/COEP via `public/serve.json`.           |
| Producer timeout invariant               | `PRODUCER_TIMEOUT_BLOCKS` (24) and 10 ms emergency fade enforced in `src/audio/workletCore.ts`.                   |

---

## 9. What automation does and does not claim

This guide is the boundary between objective validation and
subjective audibility:

- **Automated validation proves:** the engine transitions through the
  correct states, the worklet publishes finite non-zero peak/RMS, the
  ring advances monotonically, the producer timeout fires and the
  worklet fades to exact zero, recovery reconstructs one executor and
  one worklet node, the devmode telemetry shape is complete and
  read-only, and every named control is reachable in the browser.
- **Automation does not claim:** that the user can hear anything, that
  the tone is a pleasant 440 Hz, that the click-free re-eval is truly
  click-free, or that the producer-death fade sounds graceful. You
  must judge these by listening.

If any objective check fails during your run, file an Ergo follow-up
under the synthesis epic (`5e66a48b`) rather than marking subjective
listening as passed.
