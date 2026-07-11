import {
  For,
  Show,
  createEffect,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from "solid-js";
import {
  ACTIONS,
  PROFILES,
  analyzeRun,
  bindingFor,
  createInitialState,
  formatProgram,
  formatSteps,
  guidanceFor,
  invokeAction,
  isComplete,
  recordRawInput,
  recordUnbound,
  resolveGesture,
  waveformPath,
  type InputMode,
  type LabActionId,
  type Lens,
  type MotorProfile,
  type RunSummary,
  type TraceEvent,
} from "./model";

const TARGET_ACTION: LabActionId = "edit.transposeNext";

const GAMEPAD_BUTTONS: readonly [number, string][] = [
  [0, "A"],
  [1, "B"],
  [2, "X"],
  [3, "Y"],
  [4, "LB"],
  [5, "RB"],
  [9, "Start"],
  [12, "D-pad ↑"],
  [13, "D-pad ↓"],
  [14, "D-pad ←"],
  [15, "D-pad →"],
] as const;

function baseKey(event: KeyboardEvent): string {
  if (event.code === "Space") return "Space";
  if (event.code === "Enter") return "Enter";
  if (event.code === "Backspace") return "Backspace";
  if (event.code.startsWith("Arrow")) return event.code;
  if (event.code.startsWith("Key")) return event.code.slice(3);
  return event.key.length === 1 ? event.key.toUpperCase() : event.key;
}

function chordForKeyboard(event: KeyboardEvent): string {
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  return [...modifiers, baseKey(event)].join("+");
}

function formatDuration(milliseconds: number): string {
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  return `${(milliseconds / 1000).toFixed(1)} s`;
}

function semanticLabel(event: TraceEvent | undefined): string {
  if (!event?.action) return "No semantic action";
  return ACTIONS[event.action].label;
}

function SignalStage(props: {
  liveSteps: readonly number[];
  holding: boolean;
  revision: number;
}) {
  const path = () => waveformPath(props.liveSteps);

  return (
    <section class="signal-stage" aria-labelledby="signal-heading">
      <div class="panel-heading-row">
        <div>
          <p class="eyebrow">Live signal</p>
          <h2 id="signal-heading">A1 · CV · continuous</h2>
        </div>
        <div classList={{ "runtime-state": true, "runtime-state-holding": props.holding }}>
          <span class="runtime-dot" aria-hidden="true" />
          {props.holding ? "holding last good" : `live · r${props.revision}`}
        </div>
      </div>

      <div class="wave-shell">
        <svg
          class="waveform"
          viewBox="0 0 640 164"
          role="img"
          aria-label={`Stepped CV signal with values ${props.liveSteps.join(", ")}`}
          preserveAspectRatio="none"
        >
          <g class="wave-grid" aria-hidden="true">
            <path d="M0 16H640 M0 57H640 M0 98H640 M0 139H640" />
            <path d="M160 0V164 M320 0V164 M480 0V164" />
          </g>
          <path class="wave-glow" d={path()} />
          <path class="wave-line" d={path()} />
          <rect class="wave-playhead" x="0" y="0" width="2" height="164" />
        </svg>
        <div class="beat-cells" aria-hidden="true">
          <For each={props.liveSteps}>
            {(value, index) => (
              <div class="beat-cell">
                <span class="beat-index">{index() + 1}</span>
                <span class="beat-bar" style={{ height: `${Math.max(8, value * 100)}%` }} />
                <span class="beat-value">{value.toFixed(1)}</span>
              </div>
            )}
          </For>
        </div>
      </div>
    </section>
  );
}

function ProfileMap(props: {
  active: MotorProfile["id"];
  onSelect: (profile: MotorProfile) => void;
}) {
  return (
    <div class="grammar-map" role="group" aria-label="Candidate grammar design space">
      <span class="axis-label axis-top">contextual</span>
      <span class="axis-label axis-bottom">direct</span>
      <span class="axis-label axis-left">simultaneous</span>
      <span class="axis-label axis-right">sequential</span>
      <span class="axis-line axis-horizontal" aria-hidden="true" />
      <span class="axis-line axis-vertical" aria-hidden="true" />
      <For each={PROFILES}>
        {(profile) => (
          <button
            classList={{ "map-node": true, "map-node-active": props.active === profile.id }}
            style={{
              left: `${profile.axes.simultaneity}%`,
              bottom: `${profile.axes.contextuality}%`,
            }}
            onClick={() => props.onSelect(profile)}
            aria-pressed={props.active === profile.id}
            title={profile.hypothesis}
          >
            {profile.label}
          </button>
        )}
      </For>
    </div>
  );
}

export default function App() {
  const [lab, setLab] = createSignal(createInitialState(performance.now()));
  const [profileId, setProfileId] = createSignal<MotorProfile["id"]>("shifted");
  const [inputMode, setInputMode] = createSignal<InputMode>("keyboard");
  const [lens, setLens] = createSignal<Lens>("learn");
  const [manualHeld, setManualHeld] = createSignal(false);
  const [leader, setLeader] = createSignal<string | null>(null);
  const [spaceHeld, setSpaceHeld] = createSignal(false);
  const [gamepadConnected, setGamepadConnected] = createSignal(false);
  const [controlsActive, setControlsActive] = createSignal(false);
  const [runs, setRuns] = createSignal<readonly RunSummary[]>([]);
  const [runSaved, setRunSaved] = createSignal(false);
  const [reflection, setReflection] = createSignal<ReadonlySet<string>>(new Set());
  const [copyStatus, setCopyStatus] = createSignal("");

  const profile = createMemo(() => PROFILES.find((candidate) => candidate.id === profileId()) ?? PROFILES[0]);
  const complete = createMemo(() => isComplete(lab()));
  const holdingLastGood = createMemo(() => lab().steps.some((value) => value === null));
  const targetAction = createMemo<LabActionId>(() => holdingLastGood() ? "structure.fillHole" : TARGET_ACTION);
  const guidance = createMemo(() => guidanceFor(lab(), profile(), inputMode(), targetAction()));
  const lastEvent = createMemo(() => lab().trace[lab().trace.length - 1]);
  const visibleTrace = createMemo(() => lab().trace.slice(-8).reverse());
  const summary = createMemo(() => analyzeRun(lab(), profile(), inputMode(), performance.now()));
  const showFullManual = createMemo(() => lens() !== "play" || manualHeld());

  function recordRaw(
    device: "keyboard" | "gamepad" | "onscreen" | "guide",
    phase: "down" | "up" | "composite",
    control: string,
    mode: InputMode,
    t = performance.now(),
  ) {
    const activeProfile = profile();
    setLab((current) => recordRawInput(current, {
      device,
      phase,
      control,
      profile: activeProfile.id,
      inputMode: mode,
      t,
    }));
  }

  function performGesture(
    gesture: string,
    mode: InputMode,
    device: "keyboard" | "gamepad" | "onscreen" | "guide",
    rawAlreadyRecorded = false,
  ) {
    const activeProfile = profile();
    const action = resolveGesture(activeProfile, mode, gesture);
    const t = performance.now();
    if (!rawAlreadyRecorded) recordRaw(device, "composite", gesture, mode, t);
    setInputMode(mode);
    setLeader(null);

    if (!action) {
      setLab((current) => recordUnbound(current, {
        device,
        gesture,
        t,
        profile: activeProfile.id,
        inputMode: mode,
        reason: `“${gesture}” has no action in the ${activeProfile.label} ${mode} profile.`,
      }));
      return;
    }

    setLab((current) => invokeAction(current, action, {
      device,
      gesture,
      t,
      profile: activeProfile.id,
      inputMode: mode,
    }));
  }

  function demonstrateFromGuide(action: LabActionId) {
    performGesture(bindingFor(profile(), action, inputMode()), inputMode(), "guide");
  }

  function focusStep(index: number) {
    const t = performance.now();
    const activeProfile = profile();
    setLab((current) => ({
      ...recordRawInput(current, {
        device: "onscreen",
        phase: "composite",
        control: `Select step ${index + 1}`,
        profile: activeProfile.id,
        inputMode: inputMode(),
        t,
      }),
      focus: index,
    }));
  }

  function togglePhysicalControls() {
    setControlsActive((active) => {
      if (active) {
        setLeader(null);
        setSpaceHeld(false);
      }
      return !active;
    });
  }

  function resetRun(nextProfile?: MotorProfile["id"]) {
    if (nextProfile) setProfileId(nextProfile);
    setLab(createInitialState(performance.now()));
    setRunSaved(false);
    setReflection(new Set<string>());
    setLeader(null);
    setSpaceHeld(false);
  }

  function selectProfile(next: MotorProfile) {
    if (next.id === profileId()) return;
    resetRun(next.id);
  }

  function saveRun() {
    if (!complete() || runSaved()) return;
    setRuns((current) => [...current, analyzeRun(lab(), profile(), inputMode(), performance.now())]);
    setRunSaved(true);
  }

  function tryAnotherGrammar() {
    saveRun();
    const index = PROFILES.findIndex((candidate) => candidate.id === profileId());
    resetRun(PROFILES[(index + 1) % PROFILES.length].id);
  }

  function toggleReflection(value: string) {
    setReflection((current) => {
      const next = new Set(current);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function copySession() {
    const payload = {
      schema: "useq.grammar-lab/session@1",
      profile: profile(),
      mode: inputMode(),
      reflection: [...reflection()],
      initial: formatProgram([0.2, 0.8, 0.4, 0.6]),
      final: formatProgram(lab().steps),
      live: lab().liveSteps,
      rawInputs: lab().rawInputs,
      resolvedActions: lab().trace,
      summary: analyzeRun(lab(), profile(), inputMode(), performance.now()),
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyStatus("Session copied");
    } catch {
      setCopyStatus("Clipboard unavailable");
    }
    window.setTimeout(() => setCopyStatus(""), 1800);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "?") {
      setManualHeld(true);
      return;
    }
    if (event.repeat) return;
    if (event.code === "Escape" && controlsActive()) {
      event.preventDefault();
      setControlsActive(false);
      setLeader(null);
      setSpaceHeld(false);
      return;
    }
    if (!controlsActive()) return;

    const rawT = performance.now();
    recordRaw("keyboard", "down", event.code, "keyboard", rawT);
    if ([
      "ShiftLeft", "ShiftRight", "AltLeft", "AltRight",
      "ControlLeft", "ControlRight", "MetaLeft", "MetaRight",
    ].includes(event.code)) return;

    const target = event.target instanceof Element ? event.target.closest("button, a, input, select, textarea") : null;
    if (target && (event.code === "Space" || event.code === "Enter") && !event.shiftKey && !event.altKey && !event.ctrlKey && !event.metaKey) {
      return;
    }

    const active = profile();
    const base = baseKey(event);

    if (active.id === "sequence" && base === "G") {
      event.preventDefault();
      setInputMode("keyboard");
      setLeader("G");
      return;
    }

    if (active.id === "spatial" && base === "Space") {
      event.preventDefault();
      setInputMode("keyboard");
      setSpaceHeld(true);
      return;
    }

    let gesture = chordForKeyboard(event);
    if (active.id === "sequence" && leader() === "G") {
      gesture = `G → ${base}`;
    } else if (active.id === "spatial" && spaceHeld()) {
      gesture = `Space+${base}`;
    }

    const known = active.bindings.some((binding) => binding.keyboard === gesture);
    const potentiallyStructural = base.startsWith("Arrow") || ["Space", "Enter", "Backspace", "H", "L", "U", "E", "Z"].includes(base);
    if (known || potentiallyStructural) event.preventDefault();
    performGesture(gesture, "keyboard", "keyboard", true);
  }

  function onKeyUp(event: KeyboardEvent) {
    if (event.key === "?") setManualHeld(false);
    if (controlsActive()) recordRaw("keyboard", "up", event.code, "keyboard");
    if (event.code === "Space") setSpaceHeld(false);
  }

  onMount(() => {
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    let frame = 0;
    let previousPressed = new Set<string>();
    let padLeader = false;

    const pollGamepad = () => {
      const gamepad = navigator.getGamepads?.().find(Boolean);
      setGamepadConnected(Boolean(gamepad));

      if (gamepad) {
        const pressed = new Set<string>();
        for (const [index, name] of GAMEPAD_BUTTONS) {
          if (gamepad.buttons[index]?.pressed) pressed.add(name);
        }

        const released = [...previousPressed].filter((name) => !pressed.has(name));
        for (const name of released) recordRaw("gamepad", "up", name, "gamepad");

        if (!controlsActive()) {
          previousPressed = pressed;
          frame = requestAnimationFrame(pollGamepad);
          return;
        }

        for (const name of pressed) {
          if (previousPressed.has(name)) continue;
          recordRaw("gamepad", "down", name, "gamepad");
          const active = profile();

          if (active.id === "sequence" && name === "Y") {
            padLeader = true;
            setLeader("Y");
            setInputMode("gamepad");
            continue;
          }

          if (active.id === "shifted" && (name === "LB" || name === "RB")) continue;
          if (active.id === "spatial" && name === "A") continue;

          let gesture = name;
          if (active.id === "sequence" && padLeader) {
            gesture = `Y → ${name}`;
            padLeader = false;
          } else if (active.id === "shifted" && pressed.has("LB")) {
            gesture = `LB + ${name}`;
          } else if (active.id === "shifted" && pressed.has("RB")) {
            gesture = `RB + ${name}`;
          } else if (active.id === "spatial" && pressed.has("A")) {
            gesture = `A + ${name}`;
          }

          performGesture(gesture, "gamepad", "gamepad", true);
        }

        previousPressed = pressed;
      } else {
        previousPressed = new Set();
        padLeader = false;
      }

      frame = requestAnimationFrame(pollGamepad);
    };

    frame = requestAnimationFrame(pollGamepad);
    onCleanup(() => cancelAnimationFrame(frame));
  });

  onCleanup(() => {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
  });

  createEffect(() => {
    if (!complete()) setRunSaved(false);
  });

  return (
    <div class="grammar-lab">
      <header class="lab-header">
        <a class="brand" href="#top" aria-label="uSEQ Grammar Lab home">
          <span class="brand-mark" aria-hidden="true">u</span>
          <span>SEQ</span>
          <span class="brand-slash">/</span>
          <strong>GRAMMAR LAB</strong>
        </a>

        <div class="header-thesis">
          <span class="status-pulse" aria-hidden="true" />
          concept instrument · {controlsActive() ? "physical controls active" : "physical controls idle"}
        </div>

        <nav class="segmented" aria-label="Guidance lens">
          <For each={["learn", "play", "design"] as const}>
            {(item) => (
              <button
                classList={{ active: lens() === item }}
                onClick={() => setLens(item)}
                aria-pressed={lens() === item}
              >
                {item}
              </button>
            )}
          </For>
        </nav>
      </header>

      <main id="top">
        <section class="hero" aria-labelledby="lab-title">
          <div>
            <p class="kicker">One structure. Many gestures.</p>
            <h1 id="lab-title">Find the motion your hands remember.</h1>
          </div>
          <p class="hero-copy">
            The controls are not finished. That is the point. Keep the meaning stable,
            change the motion, and feel what disappears.
          </p>
        </section>

        <section class="task-strip" aria-labelledby="task-title">
          <div class="task-number">01</div>
          <div class="task-copy">
            <p class="eyebrow">Embodied etude</p>
            <h2 id="task-title">Move the high step one beat later.</h2>
          </div>
          <div class="task-state" aria-live="polite">
            <Show when={complete()} fallback={<><span>Peak</span> beat 2 → beat 3</>}>
              <span class="complete-mark">Meaning changed. Signal continued.</span>
            </Show>
          </div>
          <button class="quiet-button" onClick={() => resetRun()}>
            Reset run
          </button>
        </section>

        <div class="instrument-grid">
          <div class="instrument-column">
            <SignalStage
              liveSteps={lab().liveSteps}
              holding={holdingLastGood()}
              revision={lab().liveRevision}
            />

            <section class="structure-stage" aria-labelledby="structure-heading">
              <div class="panel-heading-row">
                <div>
                  <p class="eyebrow">Structure</p>
                  <h2 id="structure-heading">Reactive program · staged r{lab().revision}</h2>
                </div>
                <span class="focus-readout">focus · step {lab().focus + 1}</span>
              </div>

              <div class="code-expression" role="group" aria-label="Editable structural expression">
                <span aria-hidden="true">(a1 (from-list [</span>
                <For each={lab().steps}>
                  {(value, index) => (
                    <button
                      classList={{
                        "code-step": true,
                        "code-step-focused": lab().focus === index(),
                        "code-step-hole": value === null,
                        "code-step-peak": value !== null && value === Math.max(...lab().steps.filter((step): step is number => step !== null)),
                      }}
                      onClick={() => focusStep(index())}
                      aria-pressed={lab().focus === index()}
                      aria-label={`Step ${index() + 1}, ${value === null ? "structural hole" : `value ${value.toFixed(1)}`}`}
                    >
                      {value === null ? "□" : value.toFixed(1)}
                    </button>
                  )}
                </For>
                <span aria-hidden="true">] bar))</span>
              </div>

              <div class="structure-foot">
                <span>{formatProgram(lab().steps)}</span>
                <span classList={{ "continuity-note": true, warning: holdingLastGood() }}>
                  {holdingLastGood()
                    ? `incomplete r${lab().revision} · signal remains on r${lab().liveRevision}`
                    : "valid structure · reactive signal updated"}
                </span>
              </div>
            </section>

            <section class="input-stage" aria-labelledby="input-heading">
              <div class="panel-heading-row input-heading-row">
                <div>
                  <p class="eyebrow">Input surface</p>
                  <h2 id="input-heading">{profile().label} grammar</h2>
                </div>
                <div class="input-controls">
                  <div class="segmented small" role="group" aria-label="Input modality">
                    <For each={["keyboard", "gamepad"] as const}>
                      {(item) => (
                        <button
                          classList={{ active: inputMode() === item }}
                          onClick={() => setInputMode(item)}
                          aria-pressed={inputMode() === item}
                        >
                          {item}
                        </button>
                      )}
                    </For>
                  </div>
                  <span classList={{ "gamepad-state": true, connected: gamepadConnected() }}>
                    {gamepadConnected() ? "physical pad detected" : "virtual pad ready"}
                  </span>
                  <button
                    classList={{ "control-arm": true, active: controlsActive() }}
                    onClick={togglePhysicalControls}
                    aria-pressed={controlsActive()}
                  >
                    {controlsActive() ? "Controls active · Esc releases" : "Activate physical controls"}
                  </button>
                </div>
              </div>

              <Show when={leader()}>
                <div class="leader-state" role="status">
                  <span>{leader()}</span> armed · choose a direction
                </div>
              </Show>

              <div class="binding-deck">
                <For each={profile().bindings}>
                  {(binding) => (
                    <button
                      classList={{
                        "binding-key": true,
                        "binding-key-target": binding.action === targetAction(),
                      }}
                      onClick={() => performGesture(binding[inputMode()], inputMode(), "onscreen")}
                      aria-label={`${ACTIONS[binding.action].label}: ${binding[inputMode()]}`}
                    >
                      <span class="binding-gesture">{binding[inputMode()]}</span>
                      <span class="binding-action">{ACTIONS[binding.action].shortLabel}</span>
                    </button>
                  )}
                </For>
              </div>
              <p class="input-caption">
                On-screen controls always work. Activate physical controls before keyboard or gamepad gestures;
                Escape releases them so ordinary page navigation remains available.
              </p>
            </section>
          </div>

          <aside class="manual-column" aria-labelledby="manual-heading">
            <section class="living-manual">
              <div class="manual-index">LIVE / {String(lab().focus + 1).padStart(2, "0")}</div>
              <p class="eyebrow">Living manual</p>
              <Show
                when={!complete()}
                fallback={
                  <div class="completion-card">
                    <span class="completion-icon" aria-hidden="true">✓</span>
                    <h2 id="manual-heading">Same meaning. Different motion.</h2>
                    <p>
                      The focused value moved from beat two to beat three. The playhead never stopped.
                    </p>
                    <div class="reflection-prompt">
                      <p>How did that motion feel?</p>
                      <div class="reflection-chips">
                        <For each={["predictable", "comfortable", "memorable"]}>
                          {(value) => (
                            <button
                              classList={{ selected: reflection().has(value) }}
                              onClick={() => toggleReflection(value)}
                              aria-pressed={reflection().has(value)}
                            >
                              {value}
                            </button>
                          )}
                        </For>
                      </div>
                    </div>
                    <div class="completion-actions">
                      <button class="primary-button" onClick={tryAnotherGrammar}>Try another grammar</button>
                      <button class="secondary-button" onClick={saveRun} disabled={runSaved()}>
                        {runSaved() ? "Run saved" : "Save this run"}
                      </button>
                    </div>
                  </div>
                }
              >
                <h2 id="manual-heading">{guidance().action.label}</h2>
                <p class="manual-description">{guidance().action.description}</p>

                <div class="gesture-callout">
                  <span class="gesture-label">{inputMode()} gesture</span>
                  <kbd>{guidance().gesture}</kbd>
                </div>

                <Show when={showFullManual()} fallback={<p class="play-hint">Hold <kbd>?</kbd> for the living manual.</p>}>
                  <dl class="manual-details">
                    <div>
                      <dt>Available because</dt>
                      <dd>{guidance().reason}</dd>
                    </div>
                    <div>
                      <dt>Structural preview</dt>
                      <dd>
                        <code>{guidance().previewBefore}</code>
                        <span aria-hidden="true"> → </span>
                        <code>{guidance().previewAfter}</code>
                      </dd>
                    </div>
                    <div>
                      <dt>Recovery</dt>
                      <dd>{bindingFor(profile(), "history.undo", inputMode())} restores structure, focus, and signal.</dd>
                    </div>
                  </dl>
                </Show>

                <button
                  class="primary-button manual-perform"
                  onClick={() => demonstrateFromGuide(targetAction())}
                  disabled={!guidance().available}
                >
                  Show demonstration
                </button>
                <p class="assist-note">Demonstrations resolve the displayed gesture but are excluded from motor-performance counts.</p>
              </Show>
            </section>

            <section class="causal-trace" aria-labelledby="causal-heading">
              <div class="panel-heading-row">
                <div>
                  <p class="eyebrow">Causal trace</p>
                  <h2 id="causal-heading">Hand → meaning → structure → signal</h2>
                </div>
              </div>
              <div class="causal-pipeline" aria-live="polite">
                <div>
                  <span>gesture</span>
                  <strong>{lastEvent()?.gesture ?? "waiting for input"}</strong>
                </div>
                <i aria-hidden="true">→</i>
                <div>
                  <span>semantic action</span>
                  <strong>{semanticLabel(lastEvent())}</strong>
                </div>
                <i aria-hidden="true">→</i>
                <div>
                  <span>structure</span>
                  <strong>{lastEvent()?.after ?? formatSteps(lab().steps)}</strong>
                </div>
                <i aria-hidden="true">→</i>
                <div>
                  <span>signal</span>
                  <strong>{lastEvent()?.signal ?? "continuous"}</strong>
                </div>
              </div>

              <Show when={lens() === "design" || manualHeld()}>
                <ol class="trace-log" aria-label="Recent resolved input events">
                  <For each={visibleTrace()} fallback={<li class="trace-empty">No events yet. Try an input.</li>}>
                    {(event) => (
                      <li class={`trace-${event.status}`}>
                        <span>#{event.seq}</span>
                        <code>{event.gesture}</code>
                        <strong>{event.action ?? "unbound"}</strong>
                        <em>{event.status}</em>
                      </li>
                    )}
                  </For>
                </ol>
              </Show>
            </section>

            <section class="profile-hypothesis" aria-labelledby="hypothesis-heading">
              <p class="eyebrow">Active hypothesis</p>
              <h2 id="hypothesis-heading">{profile().hypothesis}</h2>
              <p>{profile().tradeoff}</p>
              <div class="hypothesis-meta">
                <span>{profile().status}</span>
                <span>{profile().tension}</span>
                <span>{summary().appliedActions} motor actions</span>
              </div>
            </section>
          </aside>
        </div>

        <section class="profiles-section" aria-labelledby="profiles-heading">
          <div class="section-intro">
            <div>
              <p class="eyebrow">Candidate space</p>
              <h2 id="profiles-heading">Change the motion, not the meaning.</h2>
            </div>
            <p>
              These are concept hypotheses, not production mappings or winners. Selecting one starts the same etude from the same state.
            </p>
          </div>

          <div class="profiles-layout">
            <div class="profile-cards">
              <For each={PROFILES}>
                {(candidate) => (
                  <button
                    classList={{ "profile-card": true, active: profileId() === candidate.id }}
                    onClick={() => selectProfile(candidate)}
                    aria-pressed={profileId() === candidate.id}
                    aria-label={`${candidate.label} grammar: ${candidate.hypothesis}`}
                  >
                    <span class="profile-card-top">
                      <strong>{candidate.label}</strong>
                      <small>{candidate.status}</small>
                    </span>
                    <span>{candidate.hypothesis}</span>
                    <em>{bindingFor(candidate, TARGET_ACTION, inputMode())}</em>
                  </button>
                )}
              </For>
            </div>
            <ProfileMap active={profileId()} onSelect={selectProfile} />
          </div>
        </section>

        <section class="research-section" aria-labelledby="research-heading">
          <div class="research-notebook">
            <div class="panel-heading-row">
              <div>
                <p class="eyebrow">Local trace notebook</p>
                <h2 id="research-heading">Trace, not verdict.</h2>
              </div>
              <button class="quiet-button" onClick={copySession}>Copy session JSON</button>
            </div>
            <p class="research-copy">
              Raw control edges and resolved semantic actions are exported as separate streams. This concept model
              never uploads, scores, or silently remaps controls; it is not yet evidence about the production editor.
            </p>
            <div class="metric-grid">
              <div><span>elapsed</span><strong>{formatDuration(summary().elapsedMs)}</strong></div>
              <div><span>applied</span><strong>{summary().appliedActions}</strong></div>
              <div><span>corrections</span><strong>{summary().corrections}</strong></div>
              <div><span>blocked</span><strong>{summary().blocked}</strong></div>
              <div><span>unbound</span><strong>{summary().unbound}</strong></div>
              <div><span>assisted</span><strong>{summary().assisted}</strong></div>
              <div><span>pointer</span><strong>{summary().pointerSelections}</strong></div>
            </div>
            <span class="copy-status" role="status">{copyStatus()}</span>
          </div>

          <div class="run-comparison">
            <p class="eyebrow">Compared runs</p>
            <Show
              when={runs().length > 0}
              fallback={
                <div class="comparison-empty">
                  Complete the etude, save the run, then try another grammar. The lab compares traces without declaring a winner.
                </div>
              }
            >
              <table>
                <thead>
                  <tr><th>Grammar</th><th>Input</th><th>Time</th><th>Actions</th><th>Corrections</th><th>Assisted</th></tr>
                </thead>
                <tbody>
                  <For each={runs()}>
                    {(run) => (
                      <tr>
                        <th>{run.profileLabel}</th>
                        <td>{run.device}</td>
                        <td>{formatDuration(run.elapsedMs)}</td>
                        <td>{run.appliedActions}</td>
                        <td>{run.corrections}</td>
                        <td>{run.assisted}</td>
                      </tr>
                    )}
                  </For>
                </tbody>
              </table>
            </Show>
          </div>
        </section>

        <section class="vision-section" aria-labelledby="vision-heading">
          <div class="vision-statement">
            <p class="eyebrow">Why this exists</p>
            <h2 id="vision-heading">An instrument that teaches the grammar it is still discovering.</h2>
            <p>
              Beginners and masters share one semantic vocabulary. Guidance fades; meanings remain.
              Keyboard and gamepad are peers. Invalid structure never silences the last valid signal.
            </p>
          </div>
          <div class="horizon" role="list" aria-label="Product horizon">
            <div class="horizon-item active" role="listitem"><span>Now</span><strong>Structural signals</strong><small>WASM / RP2040 → CV</small></div>
            <div class="horizon-line" aria-hidden="true" />
            <div class="horizon-item" role="listitem"><span>Next</span><strong>Audio-rate WASM</strong><small>the same grammar → synthesis</small></div>
            <div class="horizon-line" aria-hidden="true" />
            <div class="horizon-item" role="listitem"><span>Later</span><strong>Sample structures</strong><small>the same grammar → material</small></div>
          </div>
        </section>
      </main>

      <footer>
        <span>uSEQ Grammar Lab · executable conversation artifact</span>
        <span>Hold <kbd>?</kbd> for context · no data leaves this page</span>
      </footer>
    </div>
  );
}
