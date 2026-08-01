---
stability: stable
layer: behavioural
---

# Synthesis Engine

> Spec (accepted v1): the browser-based modular audio engine that turns uSEQ
> Perform into a standalone instrument. A fixed, curated registry of
> **NodeDefs** (low-level modules and high-level voices) is instantiated,
> patched, and parameter-controlled from ModuLisp programs; the app hosts
> the audio-rate DSP in an AudioWorklet and feeds it control signals
> sampled by the WASM executor. Counterpart to [MAIN.md](MAIN.md).
> Language counterpart (owns form syntax, NodeDef contract semantics,
> identity, lifecycle, vectors, failure semantics — cited, not restated,
> here): `../../src-useq/docs/specs/synth-nodes.md`.
> See also [runtime-modes.md](runtime-modes.md) (audio as a capability),
> [visualisation.md](visualisation.md) (shared sampling),
> `../../src-useq/docs/specs/visualisation-projection.md` (projection/frontier
> machinery this transport builds on), [probes.md](probes.md),
> [live-edit.md](live-edit.md) (param widgets),
> [state-identity.md](state-identity.md) (node identity machinery),
> [transport.md](transport.md) (clock ownership).

### Status

Accepted (v1), hardened by adversarial review 2026-07. Decisions fixed
in the July 2026 design pass; source-file references will be added as
the implementation lands.

Source references (M2.2, 2026-07-20): the host-owned zone arena of §2.3
and the resource bounds of §3.5 are implemented by
`src/audio/workletZoneAllocator.ts`; the multi-instance topological
block execution, port-offset wiring, and silence-zone retirement
semantics of §3.1 by `src/audio/workletCore.ts` (worklet shell:
`src/audio/synthesisWorklet.ts`); eval-commit fan-out and the
`MAX_SYNTH_NODES` + channel-pool commit-time checks by
`src/audio/engineCommitCoordinator.ts` + `src/audio/synthesisService.ts`.
Routing (epic M2.2) is live: the coordinator derives per-(node, param)
block-rate channels and audio-input wiring from the compiler artefact's
control table and `connections` (`synth-nodes.md` §7.2.1); the Worker
producer publishes the per-(node, param) channel set (composite
`controlChannelKey` names plus original compiler indices, compiler table
order = SAB channel order after rate filtering); the worklet consumes named
per-node channel assignments. The M2.1 interim
fixed window (`INTERIM_BLOCK_RATE_CHANNELS_PER_NODE`) is deleted per its
recorded removal condition. `useq_tick_synth_controls` now advances the live
VM once per produced block and returns values in exact compiler control-table
order; commit-time defaults are prefill only, never the steady-state source.

Known required amendments to other specs:
[runtime-modes.md](runtime-modes.md) §1.5.2 (sampling-degradation carve-out,
§4.9 here), [MAIN.md](MAIN.md) §2.10 (WASM crash recovery while WASM is the
audio control producer, §5.5 here).

---

## 1. Frame

1.1 Until now the app has only made sound through the hardware module.
The synthesis engine makes the browser a complete instrument: ModuLisp
remains control-rate; audio-rate DSP is provided by a curated NodeDef
registry and executed in an AudioWorklet.

1.2 SuperCollider analogy (design north star): NodeDefs ≈ SynthDefs,
node instances ≈ synth nodes on the server, inline routing ≈ busses,
the control transport ≈ control-rate bus mapping. Direct ancestor:
TimeLines (Haskell/SC), which drove per-param control signals into a
fixed SynthDef set — this engine is that architecture rebuilt on the
uSEQ signal engine with live per-block sampling instead of pre-rendered
buffer windows.

1.3 Three layers, deliberately decoupled: the **NodeDef registry** (§2)
— what DSP exists; the **worklet host** (§3) — where DSP runs; the
**control transport** (§4) — how ModuLisp signals reach it.

1.4 **Block.** Throughout, a *block* is the actual render quantum
observed at runtime (the `process()` buffer length; 128 samples by
default, but `renderSizeHint` and future user agents may vary it). All
constants and targets expressed in blocks are parametric on the active
quantum size.

---

## 2. NodeDef Registry

2.1 A NodeDef packages the contract (name, version, audio I/O layout,
params with defaults/ranges/rate-class/smoothing-class, voice fan-out —
as specified language-side in `synth-nodes.md` §2) plus a DSP
implementation artefact, its **build metadata** (§2.3), and optional
presentation metadata (an internal structure hint for the graph
overview, §7.5.1).

2.2 **DSP authoring is Faust-first**: defs are written in Faust and
compiled offline to WASM (no runtime libfaust). Rationale: mature,
antialiased, tested DSP library. The contract is **DSP-source-agnostic**
— a hand-written WASM def slots into the same registry entry shape.

2.3 **Build contract** (conformance requirements for every def,
regardless of source):
- compiled against **imported shared memory**: the host owns a single
  WASM linear memory with a zone allocator; per-instance DSP state and
  audio I/O buffers are host-allocated zones, and node ports are offsets
  into that memory — patch-graph "stitching" is pointer wiring, never
  per-block copying;
- **flush-to-zero** on all recursive paths (Faust `-ftz 2` or
  equivalent): WASM has no FTZ mode and subnormal tails would silently
  destroy the CPU budget;
- a **param addressing map**: Faust UI paths (or the def's native param
  handles) → contract param names, shipped as registry metadata;
- `linear`/`slew` smoothing implemented *inside* the def per the
  declared class and time constant (`synth-nodes.md` §2.5); `latch`
  params declared as **event ports** — realised as audio-input buffers
  the host fills with sample-accurate edges (§4.6);
- params that must be audio-rate modulatable declared as audio inputs,
  not params.

2.3.1 **Module-owned metadata.** Each executable module exports its complete
registry JSON. Browser preflight and worklet installation decode that exact
module descriptor and compare it with the editor registry entry. Missing,
unterminated, malformed, incomplete, or mismatched metadata rejects the
module; the editor descriptor is never substituted as a fallback.

2.3.2 **Actual render sample rate.** A fixed-rate legacy module is admissible
only when `AudioContext.sampleRate` equals its exported nominal rate. A
rate-dependent module may instead export the paired, versioned capability
`sample_rate_abi_version = 1` plus `compute_at_sample_rate`; the worklet then
passes the actual context rate on every compute call. Missing halves, unknown
versions, zero/invalid rates, and metadata/export disagreement fail closed.
Per-call delivery is instance-safe and avoids mutable configuration in shared
linear memory.

2.3.3 **Executable audio-input ABI.** Input port names and order are part of
the module descriptor. `osc/sine` version 2 declares one input named `fm` and
exports `compute_fm` plus `compute_fm_at_sample_rate`; the adapter rejects a
missing export, a renamed/reordered port, or an input vector of the wrong
width. The worklet passes the routed source-zone pointer directly, so FM is
computed by the NodeDef rather than documented but ignored.

2.4 **v1 library — minimal proof set** (~6–8 defs proving both ends of
the low/high split before scaling): `osc/sine`, `osc/saw` (antialiased),
`filt/svf`, `amp/vca`, `noise/white`, `fx/delay`, `voice/fm` (curated
full voice in the TimeLines lineage), `out/stereo`. Names are namespaced
per `synth-nodes.md` §2.7 (never colliding with control-rate UGen
names). Between them the set must exercise: defaults, both rate classes,
latch event ports, voice fan-out, and audio-input routing.

2.5 Registry entries are versioned; a program referencing a def or
version the host lacks produces a compile-time capability diagnostic
(`synth-nodes.md` §3.4), never a crash.

---

## 3. Worklet Host

3.1 A single `AudioWorkletProcessor` hosts the whole patch graph. Each
node instance is a WASM instantiation of its def's module, with state
and I/O in the shared host memory (§2.3). The host executes the graph in
topological order per block. (One processor, many instances — not one
AudioWorkletNode per node.) Terminal ports accumulate in binary64; the
emergency envelope is applied to that sum, and each final sample is converted
to Web Audio's binary32 format exactly once.

3.2 **Instantiation happens on the audio thread.** `WebAssembly.Module`
objects are compiled/validated off-thread and transferred once via the
processor port; `WebAssembly.Instance` is not transferable, so the
worklet instantiates synchronously in its message handler *between*
render quanta. This, plus message deserialisation, is the explicitly
permitted allocation carve-out: allocation may occur only at
graph-mutation boundaries, never inside `process()` steady state.
(Refines [MAIN.md](MAIN.md) §3.5 for the audio thread.)

3.3 The host executes lifecycle as specified in `synth-nodes.md` §5:
fade-in on instantiate (`SYNTH_FADE_IN`, default 10 ms linear), update
in place without DSP-state reset, release fade on free
(`SYNTH_FADE_OUT`, default 30 ms), overlapping fades on def change,
fade-cancellation semantics for racing evals (`synth-nodes.md` §5.7).
Graph mutations apply at block boundaries only. Instance fades use a
sample-indexed linear envelope with exact first/last gains; the rendered sample
sequence is invariant to how the browser partitions it into render quanta.

3.4 Vector-valued params fan out to per-voice zones inside the host;
voice add/remove on width change is itself faded; voice outputs are
summed per `synth-nodes.md` §5.13.

3.5 **Resource limits** (normative host constants, checked at
eval-commit with a compile-style diagnostic on breach): `MAX_SYNTH_NODES`
(default 64 instances), `MAX_SYNTH_VOICES` (default 128 total),
`MAX_VOICE_WIDTH` (default 16 per param). WASM memory for the shared
zone arena is bounded (`SYNTH_MEMORY_MAX`, default 64 MiB); zone
exhaustion rejects the eval, never grows unboundedly.

3.5.1 **Candidate ownership is transactional.** A graph candidate is
prepared off-live: every referenced NodeDef is installed, every new
state/output zone is reserved and initialised, and the complete
topological/wiring plan validates before the worklet acknowledges
preparation. Failure releases all candidate zones. Commit only arms the
accepted candidate; it cannot mutate the live layout. An explicit activation
gate, followed by the first matching-epoch block, performs the one
block-boundary swap. The worklet acknowledges activation only after that
swap, keeping a queued revision from colliding with a committed-but-not-yet-
active candidate. Abort before the gate releases the candidate and leaves the
prior graph and its zones authoritative; after a successfully delivered gate,
a missing acknowledgement is uncertain and must never trigger rollback or
release the serial commit queue. Disposal is the only host-side cancellation.

3.6 **Failure-atomic NodeDef calls.** A WASM trap during candidate adapter
creation or initialisation rejects that candidate and releases its zones. For
every live compute call, the host copies the state zone into a preallocated
rollback image and clears the output zone before entering WASM. A trap, a
`false` return, or any non-finite produced sample restores the prior state,
zeros the complete output zone in the same block, marks the instance health
`error`, increments the glitch counter, and emits a diagnostic naming the node
identity and failure class. Siblings and downstream nodes continue (the latter
read silence from the failed node). The instance remains live and retries on
the next block; its first later successful finite block commits state/output
and returns health to `ok`. Snapshot storage is allocated only at graph-mutation
boundaries. **Overload rule:** if the block deadline is missed
for `OVERLOAD_BLOCKS` consecutive blocks (default 8), the engine fades
all output to silence and enters the `error` engine state (§6.4) — never
sustained glitching.

3.7 `AudioContext` start requires user activation. See §6.5 for the full
resume/suspension contract (including the gamepad caveat).

---

## 4. Control Transport

4.1 **Producer placement — Worker, from v1.** A dedicated Worker owns
the WASM executor while the engine runs and is the sole producer of
control samples. It is paced by the consumer: the worklet publishes its
`currentFrame` into the SAB header each block, and the producer wakes
via `Atomics.wait` on that index. Rationale (normative, not incidental):
a main-thread producer is rAF-paced (~16.7 ms, unbounded under jank,
halted in background tabs), which exceeds any reasonable lookahead —
underrun would be structural. There is exactly **one** live executor
instance and no WASM↔WASM [state-sync](state-sync.md) problem; while audio
owns advancement, visualisation/probes may observe through read-only sampling
but may not issue a second live tick.

4.2 **Clock domain — audio is master.** While the engine is `running`, the audio
frame counter is the master timeline: transport time is a function of
audio frame (`t = f(currentFrame)`, the frame→beat map owned by the
transport machine, [transport.md](transport.md)). The internal rAF clock
([MAIN.md](MAIN.md)) drives time whenever the audio producer is not running
(including `off`, `suspended`, and `error`). A suspended AudioContext has
not started producing frames, so it cannot own the timeline. This
removes `AudioContext.currentTime` vs `performance.now()` drift by
construction.

4.3 **Stateful signals and lookahead.** The producer executes **live
ticks** of the executor at upcoming audio-frame times — because audio
frames *are* the master clock, producing ahead is not speculation about
a different timeline but simply running the live state forward of the
DAC head by the lookahead distance. No projection fork is involved in
the audio path. While this producer owns live advancement,
`useq_tick_and_project` is disabled and visualisation falls back to read-only
time-window sampling, so two app consumers cannot advance the same stateful
VM. External inputs (hardware, MIDI, live-edit values)
sampled by the executor take effect at the next *produced* block, i.e.
with worst-case latency of one lookahead window (§4.5). Visualisation's
future-rendering continues to use the projection fork
(`visualisation-projection.md`) against this frontier.

4.4 **Ring and epochs.** Control data flows through a SAB ring of
per-block records. Every ring block and every graph-delta message carries
a **program epoch**. A delta activates at the first ring block bearing
its epoch; before arming a switch, the producer must pre-fill ≥ 1 block
of new-program samples, with NodeDef defaults for any channel not yet
sampled — a newly instantiated node never reads stale or undefined
slots.

4.4.1 **Failure-atomic epoch switch.** The Worker first reserves a candidate
compiler-to-SAB mapping without changing the running producer. Each block-rate
row carries its exact compiler control index and collision-free channel key;
indices must be in range, unique, and strictly increasing after rate filtering.
Only after the worklet accepts and commits the complete graph candidate may
`producerArmEpoch` atomically publish that control layout and epoch. The
worklet still cannot activate until the service opens its explicit activation
gate. Any rejection or missing acknowledgement before that gate aborts both
participants: the Worker restores its prior epoch/layout/mapping and the
worklet releases candidate zones. After a successfully posted gate, the host
waits without an ordinary timeout for the block-boundary acknowledgement; an
uncertain commit is neither rolled back nor followed by another preparation.
No partial delta or mismatched control layout becomes live.

4.5 **Lookahead and latency.** Lookahead is `CONTROL_LOOKAHEAD` blocks
(default 6, permitted range 4–8). Stated consequence: control latency =
lookahead × block ≈ 16 ms at 48 kHz/128, plus `AudioContext.outputLatency`
to the ear. This budget is normative (§8.4). In `hardware + audio`
hybrid rigs, hardware CV/gates and browser audio driven by the same
expression are **not aligned by default** (hardware leads by roughly
the control latency + output latency). A manual **hybrid alignment
offset** setting (`audio.alignmentOffsetMs`, default 0 = off, mutated
via runtimeService like all settings) compensates by adding a constant
shift to the audio frame→transport-time mapping, so the engine renders
the program correspondingly earlier and browser audio meets the rack.
The setting is inert unless hardware is connected. Automatic offset
detection via audio loopback is deferred (§9.4).

4.6 **Latch channels are event channels.** For `latch` (gate/trigger)
params the producer detects the crossing inside the block and ships
`(value, frameOffset)` edge records; the host synthesises sample-accurate
steps into the def's event port (§2.3). Gate edges are therefore *not*
quantised to block boundaries; their timing error is bounded by the
producer's sampling resolution of the crossing, which must be ≤ 1 frame.

4.7 **Underrun and producer liveness.** On ring underrun the worklet
holds last values (smoothing classes still honoured; latched gates hold,
never re-fire) and increments a diagnostic counter. If no ring writes
arrive for `PRODUCER_TIMEOUT_BLOCKS` (default 24, ≈ 64 ms), the engine
fades all output to silence and enters `error` (§6.4) — a dead producer
must never yield an indefinite drone.

4.8 **SAB ABI.** The layout (header with frame index + epochs, per-block
channel records, `fast`-class channels carrying their declared
points-per-block, event-channel edge records) is a versioned internal
ABI; version mismatch between app bundle and worklet bundle is a fatal
startup error in the spirit of [MAIN.md](MAIN.md) §2.3. Publication is
index-published with `Atomics` (release-store of the write index after
payload writes; acquire-load on read) — torn reads are excluded by
contract, not luck.

4.9 **Degradation priority.** Under producer overload the shed order is:
probe/vis channels first, then vis frame rate, and audio control
channels last — and audio channels are only ever *whole blocks late*,
never per-channel skipped (a frozen arbitrary param is worse than a
late block). This amends [runtime-modes.md](runtime-modes.md) §1.5.2's
best-effort sampling rule for the audio-capable case; serial-transport
traffic retains top priority.

4.10 **Transport events.** Pause: the ring is flushed, engine output
fades to silence, and the context suspends (state preserved; resume
refills the ring before unsuspending). Stop: all nodes release-fade;
the graph structure is retained. Rewind/seek and tempo change: the ring
is flushed and refilled at the new frame→time mapping; per-param
smoothing absorbs the control discontinuity, latch channels re-derive
edges (no spurious retrigger from the jump itself). The same
flush-and-refill applies when the time source switches (e.g. hardware
disconnect in `both + audio`).

---

## 5. Eval Lifecycle

5.1 Lifecycle *semantics* — upsert-per-eval, document-sync eval as the
whole-truth action, explicit free, per-identity diff cases, racing
fades, failed-eval no-op — are owned by `synth-nodes.md` §5 and not
restated here. This section specifies app mechanics.

5.1.1 **Compiler bundle provenance.** Before publishing browser assets, the
app requires `useq.compiler-capabilities/v1` from the clean checked-out
`src-useq` commit. Its source commit must equal the submodule HEAD, its synth
ABI must equal 2, and its byte counts and SHA-256 records must match both the
built and served `useq.js`/`useq.wasm`. The served manifest is an exact copy.
The compiler manifest does not authenticate `osc_sine.wasm`: NodeDefs are
separate build/provenance domains, copied byte-for-byte and admitted by their
own module-owned metadata and export validation at load time. After bundling,
the app deterministically emits `useq.served-bundle/v1`, which binds the exact
compiler-manifest, interpreter JS/WASM, NodeDef WASM plus its module-emitted
descriptor identity, and synthesis-worklet bytes. This record is explicitly
unsigned (`authenticated: false`): it detects stale/mixed local outputs and
gives experiments one complete served-bundle identity, but does not prove a
publisher, source repository, or supply-chain authority.

5.1.2 The app accepts compiler artifacts only after exhaustive structural
validation against ABI 2 and the configured NodeDef registry: integer/string
bounds, unique declaration identities and control keys, descriptor metadata,
control ownership/rate/smoothing contracts, connection endpoints and port
indices, single-driver inputs, and acyclic routing. Validation runs before
stale-revision handling, epoch allocation, planning, worklet/producer
messages, or audio activation. Rejection returns a reason-bearing error and
has no engine-side effect.

5.1.3 A current, valid artefact enters a serial prepare/commit transaction.
The service waits for: complete worklet preparation, producer control-layout
reservation, worklet commit acknowledgement, an exact matching producer arm,
and the worklet's matching block-boundary activation acknowledgement, in that
order. The service publishes the new revision/declaration set only after all
five acknowledgements. Before the activation gate, timeout, negative
acknowledgement, thrown port operation, disposal, or a newer winning revision
aborts the candidate and returns
`rejected-preparation-failed` (or `rejected-superseded` for the revision
race). After the gate, there is no ordinary timeout: disposal may end the wait,
but the service neither rolls back nor admits another commit while activation
is uncertain. The prior running graph remains live. Commit intake never constructs
or resumes an `AudioContext`; it requires the already-prepared engine session,
so lifecycle activation and graph publication cannot be conflated.

5.2 On eval commit, the app diffs the declared identities against the
running graph and ships an epoch-tagged delta (§4.4):
instantiate / update-in-place / free-with-fade / def-change
(free + instantiate, overlapping fades). Param-expression-only changes
touch no DSP state.

5.3 The **document-sync eval** (`synth-nodes.md` §5.6a) is an explicit
editor action (action registry: `eval.document`), distinct from
per-form eval; it evaluates the whole buffer with whole-truth node
semantics, announcing its blast radius ("N ghosts will be freed")
before firing. Per-node free is available from the node card (§7.2) and
as `(free ...)`; `(useq-clear)` frees all nodes.

5.3.1 **Ghost affordances.** Nodes sounding without a corresponding
document form (*ghosts*) are surfaced in a **status strip** (toolbar
count, e.g. "5 sounding · 2 ghosts") — the buffer itself stays
pristine. Hovering the strip expands the ghost list; each expanded
entry carries the actions: **stop** (immediate, no fade), **fade out**
(release fade at `SYNTH_FADE_OUT` default), and **restore code** —
reinsert the identity's last-known-active source text into the buffer.
(Decision 2026-07-18: playground variant B — strip-only; inline ghost
cards rejected for buffer noise.) To power restore, the app retains the
last successfully evaluated source per active identity, persisted with
the session per [persistence.md](persistence.md) conventions.

5.4 **Health.** Per-node health (`running` / `fallback` / `error`, as
defined in `synth-nodes.md` §5.9) joins the existing output-health
surface ([code-evaluation.md](code-evaluation.md)): sourced from
compile/commit diagnostics, the producer's non-finite substitutions, and
worklet-side counters (underrun, trap, overload). Rendered on node cards
and in the console per [MAIN.md](MAIN.md) §2.7.

5.5 **Producer/WASM crash.** If the executor crashes while acting as
control producer, the liveness rule (§4.7) silences the engine into
`error` — audibly and visibly, amending [MAIN.md](MAIN.md) §2.10's
"silent reinitialisation" for the audio case (silent recovery of the
thing making sound is indistinguishable from a bug). On successful
reinit the app re-evaluates the LKG program, rebuilds the patch graph at
a fresh epoch, and the engine fades back in; on failure it remains in
`error` with a console diagnostic and, in `both` mode, hardware
operation continues unaffected. In production, the explicit `error`
indicator click is the recovery trigger: it performs that reinitialisation
and then attempts user-activated resume in the same gesture; ambient
autoplay interactions MUST NOT trigger recovery.

---

## 6. Runtime Modes

6.1 Audio is a **capability orthogonal to runtime mode**
([runtime-modes.md](runtime-modes.md)) — with one constraint: it always
requires the WASM executor as compiler and control producer
(`synth-nodes.md` §6.1). `wasm + audio` is the standalone instrument.
"`hardware + audio`" necessarily runs a WASM instance too, and is
therefore `both + audio` in runtime-mode terms even if the user thinks
of it as "hardware plus sound"; the mode matrix gains no new impossible
states.

6.2 Hardware outputs `a1–a8`/`d1–d8` and synth nodes are independent
sinks that may share sub-expressions. (Alignment caveat: §4.5.)

6.3 Audio capability is absent when the browser lacks AudioWorklet or
SharedArrayBuffer support. SAB requires cross-origin isolation
(COOP/COEP; `crossOriginIsolated === true`) — a bootstrap-level
constraint that affects *all* cross-origin fetches, including `?gist`
deep links ([url-params.md](url-params.md)), which need CORS or
`credentialless` handling. A `postMessage`-per-block fallback transport
is explicitly **rejected** (allocation on the audio thread, unbounded
jitter, no ordering guarantees); without isolation the app degrades to
current no-audio behaviour with a clear capability diagnostic.

6.4 The mode indicator gains an audio-engine state:
`off` / `suspended` / `running` / `error`. Concretely testable
requirements: `suspended` and `error` each render a distinct indicator
state, post a console message, and expose a one-click affordance
(resume / reinitialise). Clicking `error` in production MUST dispose the
failed producer resources, construct fresh engine resources, and leave the
engine in `suspended`; the same gesture MUST then attempt normal resume.
Repeated clicks during recovery MUST share one rebuild.

6.5 **Activation and resume.** `AudioContext.resume()` requires
transient user activation. Keyboard and pointer events grant it;
**gamepad input does not**, and neither do timer-driven evals (quantised
eval firing on a bar boundary, live-edit idle auto-eval) nor
boot-restored autosaved programs. Contract: there is **no dedicated
enable-sound action**. Once a program contains synth nodes, *any*
activation-carrying interaction — clicking in the buffer, pressing an
eval key, any keydown/pointerdown anywhere in the app — resumes the
engine as a side effect (a global listener attempts resume
opportunistically until it succeeds). On rejection the engine stays
`suspended` per §6.4; the suspended indicator's role is to *explain*,
chiefly for gamepad-only sessions (gamepad input cannot grant
activation), that any click or keypress will enable sound. A restored
program never auto-resumes on load; it resumes on the first
interaction. Output-only programs such as `(a1 bar)` do not create an
AudioContext merely because the editor receives a click; their
visualisation stays on the browser-local clock.

---

## 7. Editor Integration

7.1 The `(synth ...)` form is plain text — documents remain shareable
ModuLisp — but the editor treats it as a first-class semantic object, in
phases:

7.2 **Node rail** (first): the structural/gutter machinery renders each
synth form **text-first** — the code stays the primary, directly
editable surface — decorated with: a coloured health rail (§5.4)
spanning the form; a floating chip row (def name, instance name or
generated-identity indicator, voice count, free affordance §5.3); and a
single collapsed **ghost line** summarising omitted params with their
defaults, expanding on click into per-param rows. (Decision 2026-07-18:
rail variant chosen over full structured cards — see
`../design/mockups/synthesis-ui-playground.html`, variant A.) Ghost
rows/lines are widget-only decorations: they exist in no serialisation
of the document until materialised (§7.4), preserving
[formatting.md](formatting.md)'s layout-intent rules. A malformed form
(unknown def, duplicate param, mid-edit unparseable) degrades
gracefully: the rail carries the diagnostic and never blocks text
editing.

7.2.1 **Per-param oscilloscopes** are togglable per param row and **off
by default** — each live scope costs sampling and screen/buffer real
estate, so attention is spent deliberately. Toggling one attaches the
probe/vis machinery (§7.3) to that param's control signal in place;
toggle state persists with the session.

7.3 **Per-param vis/probes**: existing probe and visualisation machinery
([probes.md](probes.md), [visualisation.md](visualisation.md)) attaches
per param row; param channels are grouped by node in the vis legend.
Probing uses scratch compilation, never the live patch graph
(`synth-nodes.md` §3.2).

7.4 **Param widgets**: interacting with a ghost row materialises the
binding into the form text (formatting.md rules apply). Default
materialisation is a plain literal (`:cutoff 800`); engaging drag or
MIDI learn materialises the full [live-edit.md](live-edit.md) wrapper
(`:cutoff (live-edit 800 :id …)`), since live-edit's slot/persistence/
MIDI machinery hangs off the wrapper's `:id` — a bare literal has
nothing to learn onto.

7.4.1 **Widget styles and configuration.** Knob and horizontal slider
are both available; `Ctrl+click` on a widget toggles its style
(per-widget, persisted). Specialised styles (XY pads, envelope shapes)
are deferred (§9.9). Widget range and response — min / max / step /
curve — are editable via a compact config popover on the widget; edits
are written into the live-edit wrapper's keywords
(`:min`/`:max`/`:step`/`:curve`), keeping the document the single
source of truth. Starting values come from live-edit's range inference
([live-edit.md](live-edit.md) §3.4), seeded from the NodeDef's declared
nominal range.

7.5 **Graph overview**: a read-only patch-graph visualisation (nodes +
cables) generated from the compiled patch graph. Orientation surface
first; direct manipulation deferred.

7.5.1 **Composites and expand/contract.** The graph has an
expand/contract grammar: composite nodes can be entered ("go in") and
left ("go out"). Two things render as composites: (a) a node whose
audio inputs are inline-nested anonymous synth forms — the nested chain
collapses into its parent by default; (b) a high-level NodeDef (e.g. a
voice) whose registry entry ships an optional **internal structure
hint** (§2.1) describing its sub-graph for display. Collapsed
composites show aggregate health and port counts. Expansion is purely
presentational: it never changes the runtime graph.

7.6 **Paste feedback**: every paste containing synth forms shows a
transient chip indicating the identity outcome — "forked: new node
·anon·9d21" (`Ctrl+V`) vs "linked variant of pad" (`Ctrl+Shift+V`) —
per the gesture contract in `synth-nodes.md` §5.3.1 and the paste
affordance direction of [state-identity.md](state-identity.md) §8.8.
The chip is the moment-of-action surface for the fork/link decision;
identity provenance itself is the sidecar-ID machinery of
[state-identity.md](state-identity.md) §7/§13.3, which this feature
depends on.

---

## 8. Performance Targets

Aspirational, in the spirit of [MAIN.md](MAIN.md) §3 — not hard CI
gates. **Measurement method** (normative, since the targets are
otherwise unfalsifiable): worklet-side self-timing via frame-stamped
counters published in the SAB header (`performance.now()` is not
available in `AudioWorkletGlobalScope`); producer-side via standard
timers.

8.1 32 simultaneous node instances / 64 total voices at < 50% of the
render-quantum period per block on a mid-range laptop, at the active
quantum size.

8.2 Control sampling for a full program (all channels, one block) within
1 ms in the producer Worker.

8.3 Graph deltas apply at the first block boundary after worklet receipt
of the delta message (receipt-to-application, not compile-to-application
— `postMessage` delivery latency is unbounded by the platform).
Instantiation cost (§3.2) per delta stays within one block budget for
deltas of ≤ 4 instantiations; larger deltas may amortise over
consecutive block boundaries.

8.4 End-to-end control latency (producer sample → audible) ≤ lookahead ×
block + output latency, with lookahead per §4.5. Gate-edge placement
error ≤ 1 frame (§4.6).

8.5 Shared zone arena stays under `SYNTH_MEMORY_MAX` (§3.5) at the §8.1
load; instantiating the full v1 library once fits in < 25% of it.

---

## 9. Open / Deferred

9.1 Patch statements and named busses as routing surfaces (language
§8.1).

9.2 Audio input (mic/line into the graph), recording/export, and sample
playback defs.

9.3 MIDI-driven event layers on top of the continuous model — excluded
from v1 with polyphony-via-vectors instead (language §8.4).

9.4 **Automatic hybrid-alignment detection via audio loopback**: patch
a hardware output into an audio input, measure the round-trip offset,
and set `audio.alignmentOffsetMs` (§4.5) automatically. The same
loopback path doubles as an automatic aid for 1V/oct CV calibration
([calibration.md](calibration.md)) — one measurement plumbing, two
features. Routing hardware analogue inputs into the browser patch graph
generally remains out of scope (latency likely prohibitive; needs
measurement).

9.5 Editor-side identity-migrating rename for explicit names (language
§8.6).

9.6 Amendments to [runtime-modes.md](runtime-modes.md) §1.5.2 and
[MAIN.md](MAIN.md) §2.10 flagged under **Status**.

9.7 **ModuLisp-embedded DSP DSL** compiling to Faust for user-authored
defs (language §8.8): registry and contract must admit
runtime-registered defs; requires libfaust-in-browser or a compile
service. Out of v1.

9.8 **Per-binding rate/smoothing override** (language §8.9): user-side
class override at the use site. The SAB channel table already carries
class per channel, so the transport admits it without ABI change. Out
of v1.

9.9 **Specialised widget styles** beyond knob/slider (XY pads, envelope
editors, multi-param macro widgets) — §7.4.1.

9.10 **Graph direct manipulation** (patching by dragging cables) —
§7.5 stays read-only in v1.
