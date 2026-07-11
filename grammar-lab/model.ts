export type LabActionId =
  | "focus.prev"
  | "focus.next"
  | "edit.transposePrev"
  | "edit.transposeNext"
  | "value.decrease"
  | "value.increase"
  | "structure.makeHole"
  | "structure.fillHole"
  | "history.undo"
  | "program.commit";

export type Device = "keyboard" | "gamepad" | "onscreen" | "guide";
export type InputMode = "keyboard" | "gamepad";
export type Lens = "learn" | "play" | "design";
export type StepValue = number | null;

export interface ActionDefinition {
  readonly id: LabActionId;
  readonly label: string;
  readonly shortLabel: string;
  readonly description: string;
  readonly category: "navigate" | "transform" | "value" | "runtime";
  readonly reversible: boolean;
}

export interface MotorBinding {
  readonly action: LabActionId;
  readonly keyboard: string;
  readonly gamepad: string;
}

export interface MotorProfile {
  readonly id: "direct" | "shifted" | "sequence" | "spatial";
  readonly label: string;
  readonly status: "lab" | "candidate";
  readonly hypothesis: string;
  readonly tension: string;
  readonly tradeoff: string;
  readonly axes: {
    readonly simultaneity: number;
    readonly contextuality: number;
  };
  readonly bindings: readonly MotorBinding[];
}

export interface LabSnapshot {
  readonly steps: readonly StepValue[];
  readonly liveSteps: readonly number[];
  readonly focus: number;
  readonly revision: number;
  readonly liveRevision: number;
}

export interface TraceEvent {
  readonly seq: number;
  readonly t: number;
  readonly device: Device;
  readonly gesture: string;
  readonly action: LabActionId | null;
  readonly status: "applied" | "blocked" | "unbound";
  readonly reason?: string;
  readonly before: string;
  readonly after: string;
  readonly focusBefore: number;
  readonly focusAfter: number;
  readonly signal: "continued" | "updated" | "held-last-good";
  readonly profile: MotorProfile["id"];
  readonly inputMode: InputMode;
}

export interface RawInputEvent {
  readonly seq: number;
  readonly t: number;
  readonly device: Device;
  readonly phase: "down" | "up" | "composite";
  readonly control: string;
  readonly profile: MotorProfile["id"];
  readonly inputMode: InputMode;
}

export interface LabState extends LabSnapshot {
  readonly history: readonly LabSnapshot[];
  readonly trace: readonly TraceEvent[];
  readonly rawInputs: readonly RawInputEvent[];
  readonly nextSeq: number;
  readonly nextRawSeq: number;
  readonly startedAt: number;
  readonly completedAt: number | null;
}

export interface ActionResult {
  readonly state: LabState;
  readonly status: "applied" | "blocked";
  readonly reason?: string;
  readonly signal: TraceEvent["signal"];
}

export interface Guidance {
  readonly action: ActionDefinition;
  readonly gesture: string;
  readonly available: boolean;
  readonly reason: string;
  readonly previewBefore: string;
  readonly previewAfter: string;
}

export interface RunSummary {
  readonly profile: MotorProfile["id"];
  readonly profileLabel: string;
  readonly elapsedMs: number;
  readonly appliedActions: number;
  readonly corrections: number;
  readonly blocked: number;
  readonly unbound: number;
  readonly device: InputMode | "mixed";
  readonly assisted: number;
  readonly pointerSelections: number;
}

export const INITIAL_STEPS = [0.2, 0.8, 0.4, 0.6] as const;
export const GOAL_STEPS = [0.2, 0.4, 0.8, 0.6] as const;

export const ACTIONS: Readonly<Record<LabActionId, ActionDefinition>> = {
  "focus.prev": {
    id: "focus.prev",
    label: "Focus previous",
    shortLabel: "Previous",
    description: "Move structural focus to the previous step without changing the signal.",
    category: "navigate",
    reversible: false,
  },
  "focus.next": {
    id: "focus.next",
    label: "Focus next",
    shortLabel: "Next",
    description: "Move structural focus to the next step without changing the signal.",
    category: "navigate",
    reversible: false,
  },
  "edit.transposePrev": {
    id: "edit.transposePrev",
    label: "Move backward",
    shortLabel: "Move back",
    description: "Swap the focused node with its previous sibling while keeping focus attached to it.",
    category: "transform",
    reversible: true,
  },
  "edit.transposeNext": {
    id: "edit.transposeNext",
    label: "Move forward",
    shortLabel: "Move forward",
    description: "Swap the focused node with its next sibling while keeping focus attached to it.",
    category: "transform",
    reversible: true,
  },
  "value.decrease": {
    id: "value.decrease",
    label: "Lower value",
    shortLabel: "Lower",
    description: "Decrease the focused signal value by one tenth.",
    category: "value",
    reversible: true,
  },
  "value.increase": {
    id: "value.increase",
    label: "Raise value",
    shortLabel: "Raise",
    description: "Increase the focused signal value by one tenth.",
    category: "value",
    reversible: true,
  },
  "structure.makeHole": {
    id: "structure.makeHole",
    label: "Make a hole",
    shortLabel: "Make hole",
    description: "Remove the focused value while preserving a structural place for recovery.",
    category: "transform",
    reversible: true,
  },
  "structure.fillHole": {
    id: "structure.fillHole",
    label: "Fill the hole",
    shortLabel: "Fill hole",
    description: "Restore a neutral value into the focused structural hole.",
    category: "transform",
    reversible: true,
  },
  "history.undo": {
    id: "history.undo",
    label: "Undo",
    shortLabel: "Undo",
    description: "Restore the exact structure, focus, and live signal from before the last mutation.",
    category: "transform",
    reversible: false,
  },
  "program.commit": {
    id: "program.commit",
    label: "Evaluate structure",
    shortLabel: "Evaluate",
    description: "Publish a complete structure to the signal. Incomplete structures keep the last good signal running.",
    category: "runtime",
    reversible: false,
  },
};

const sharedDirectBindings: readonly MotorBinding[] = [
  { action: "focus.prev", keyboard: "ArrowLeft", gamepad: "D-pad ←" },
  { action: "focus.next", keyboard: "ArrowRight", gamepad: "D-pad →" },
  { action: "edit.transposePrev", keyboard: "Alt+ArrowLeft", gamepad: "LB" },
  { action: "edit.transposeNext", keyboard: "Alt+ArrowRight", gamepad: "RB" },
  { action: "value.decrease", keyboard: "ArrowDown", gamepad: "D-pad ↓" },
  { action: "value.increase", keyboard: "ArrowUp", gamepad: "D-pad ↑" },
  { action: "structure.makeHole", keyboard: "Backspace", gamepad: "X" },
  { action: "structure.fillHole", keyboard: "Enter", gamepad: "A" },
  { action: "history.undo", keyboard: "Z", gamepad: "B" },
  { action: "program.commit", keyboard: "Space", gamepad: "Start" },
];

export const PROFILES: readonly MotorProfile[] = [
  {
    id: "direct",
    label: "Direct",
    status: "candidate",
    hypothesis: "Frequent meanings deserve a dedicated motion.",
    tension: "Immediate",
    tradeoff: "Fast to invoke, but consumes scarce controls and can be harder to generalise.",
    axes: { simultaneity: 16, contextuality: 18 },
    bindings: sharedDirectBindings,
  },
  {
    id: "shifted",
    label: "Shifted",
    status: "lab",
    hypothesis: "Held layers let one spatial map carry related transformations.",
    tension: "Chorded",
    tradeoff: "Spatially coherent, with greater simultaneous load on the hands.",
    axes: { simultaneity: 23, contextuality: 74 },
    bindings: [
      { action: "focus.prev", keyboard: "ArrowLeft", gamepad: "D-pad ←" },
      { action: "focus.next", keyboard: "ArrowRight", gamepad: "D-pad →" },
      { action: "edit.transposePrev", keyboard: "Shift+ArrowLeft", gamepad: "LB + D-pad ←" },
      { action: "edit.transposeNext", keyboard: "Shift+ArrowRight", gamepad: "LB + D-pad →" },
      { action: "value.decrease", keyboard: "Shift+ArrowDown", gamepad: "RB + D-pad ↓" },
      { action: "value.increase", keyboard: "Shift+ArrowUp", gamepad: "RB + D-pad ↑" },
      { action: "structure.makeHole", keyboard: "Shift+Backspace", gamepad: "LB + X" },
      { action: "structure.fillHole", keyboard: "Shift+Enter", gamepad: "LB + A" },
      { action: "history.undo", keyboard: "Control+Z", gamepad: "B" },
      { action: "program.commit", keyboard: "Space", gamepad: "Start" },
    ],
  },
  {
    id: "sequence",
    label: "Sequence",
    status: "lab",
    hypothesis: "A short phrase can trade chord strain for memorable syntax.",
    tension: "Sequential",
    tradeoff: "Low simultaneous load, with extra timing and working-memory demands.",
    axes: { simultaneity: 82, contextuality: 72 },
    bindings: [
      { action: "focus.prev", keyboard: "H", gamepad: "D-pad ←" },
      { action: "focus.next", keyboard: "L", gamepad: "D-pad →" },
      { action: "edit.transposePrev", keyboard: "G → ArrowLeft", gamepad: "Y → D-pad ←" },
      { action: "edit.transposeNext", keyboard: "G → ArrowRight", gamepad: "Y → D-pad →" },
      { action: "value.decrease", keyboard: "G → ArrowDown", gamepad: "Y → D-pad ↓" },
      { action: "value.increase", keyboard: "G → ArrowUp", gamepad: "Y → D-pad ↑" },
      { action: "structure.makeHole", keyboard: "G → Backspace", gamepad: "Y → X" },
      { action: "structure.fillHole", keyboard: "G → Enter", gamepad: "Y → A" },
      { action: "history.undo", keyboard: "U", gamepad: "B" },
      { action: "program.commit", keyboard: "E", gamepad: "Start" },
    ],
  },
  {
    id: "spatial",
    label: "Held spatial",
    status: "lab",
    hypothesis: "A held spatial field can make the available transformation visible before commitment.",
    tension: "Continuous",
    tradeoff: "Discoverable and spatial, but potentially dependent on visual confirmation.",
    axes: { simultaneity: 73, contextuality: 25 },
    bindings: [
      { action: "focus.prev", keyboard: "A", gamepad: "D-pad ←" },
      { action: "focus.next", keyboard: "D", gamepad: "D-pad →" },
      { action: "edit.transposePrev", keyboard: "Space+ArrowLeft", gamepad: "A + D-pad ←" },
      { action: "edit.transposeNext", keyboard: "Space+ArrowRight", gamepad: "A + D-pad →" },
      { action: "value.decrease", keyboard: "Space+ArrowDown", gamepad: "A + D-pad ↓" },
      { action: "value.increase", keyboard: "Space+ArrowUp", gamepad: "A + D-pad ↑" },
      { action: "structure.makeHole", keyboard: "Space+Backspace", gamepad: "A + X" },
      { action: "structure.fillHole", keyboard: "Space+Enter", gamepad: "A + Y" },
      { action: "history.undo", keyboard: "Z", gamepad: "B" },
      { action: "program.commit", keyboard: "E", gamepad: "Start" },
    ],
  },
];

export function createInitialState(now = 0): LabState {
  return {
    steps: [...INITIAL_STEPS],
    liveSteps: [...INITIAL_STEPS],
    focus: 1,
    revision: 0,
    liveRevision: 0,
    history: [],
    trace: [],
    rawInputs: [],
    nextSeq: 1,
    nextRawSeq: 1,
    startedAt: now,
    completedAt: null,
  };
}

export function formatSteps(steps: readonly StepValue[]): string {
  return `[${steps.map((value) => value === null ? "□" : value.toFixed(1)).join(" ")}]`;
}

export function formatProgram(steps: readonly StepValue[]): string {
  return `(a1 (from-list ${formatSteps(steps)} bar))`;
}

export function isComplete(state: Pick<LabState, "steps">): boolean {
  return state.steps.every((value, index) => value === GOAL_STEPS[index]);
}

export function bindingFor(
  profile: MotorProfile,
  action: LabActionId,
  mode: InputMode,
): string {
  const binding = profile.bindings.find((candidate) => candidate.action === action);
  return binding?.[mode] ?? "Unbound";
}

export function resolveGesture(
  profile: MotorProfile,
  mode: InputMode,
  gesture: string,
): LabActionId | null {
  const matches = profile.bindings.filter((binding) => binding[mode] === gesture);
  return matches.length === 1 ? matches[0].action : null;
}

function availability(state: LabState, action: LabActionId): { available: boolean; reason: string } {
  switch (action) {
    case "focus.prev":
    case "edit.transposePrev":
      return state.focus > 0
        ? { available: true, reason: "The focused node has a previous sibling." }
        : { available: false, reason: "The focused node is already first." };
    case "focus.next":
    case "edit.transposeNext":
      return state.focus < state.steps.length - 1
        ? { available: true, reason: "The focused node has a next sibling." }
        : { available: false, reason: "The focused node is already last." };
    case "value.decrease":
    case "value.increase":
      return state.steps[state.focus] !== null
        ? { available: true, reason: "The focused node is numeric." }
        : { available: false, reason: "A structural hole has no numeric value." };
    case "structure.makeHole":
      return state.steps[state.focus] !== null
        ? { available: true, reason: "The focused value can become an explicit hole." }
        : { available: false, reason: "The focused node is already a hole." };
    case "structure.fillHole":
      return state.steps[state.focus] === null
        ? { available: true, reason: "The focused hole can accept a value." }
        : { available: false, reason: "Fill is available only on a structural hole." };
    case "history.undo":
      return state.history.length > 0
        ? { available: true, reason: "A previous structural state is available." }
        : { available: false, reason: "There is nothing to undo yet." };
    case "program.commit":
      return state.steps.every((value) => value !== null)
        ? { available: true, reason: "The structure is complete and can become the live signal." }
        : { available: false, reason: "The structure contains a hole; the last good signal will continue." };
  }
}

function snapshot(state: LabState): LabSnapshot {
  return {
    steps: [...state.steps],
    liveSteps: [...state.liveSteps],
    focus: state.focus,
    revision: state.revision,
    liveRevision: state.liveRevision,
  };
}

function withMutation(
  state: LabState,
  steps: readonly StepValue[],
  focus: number,
): Pick<LabState, "steps" | "liveSteps" | "focus" | "revision" | "liveRevision" | "history"> {
  const complete = steps.every((value) => value !== null);
  const liveChanged = complete && steps.some((value, index) => value !== state.liveSteps[index]);
  return {
    steps,
    liveSteps: liveChanged ? steps as readonly number[] : state.liveSteps,
    focus,
    revision: state.revision + 1,
    liveRevision: liveChanged ? state.liveRevision + 1 : state.liveRevision,
    history: [...state.history, snapshot(state)],
  };
}

function mutationResult(
  state: LabState,
  steps: readonly StepValue[],
  focus: number,
): ActionResult {
  const mutation = withMutation(state, steps, focus);
  const signal: TraceEvent["signal"] = steps.some((value) => value === null)
    ? "held-last-good"
    : mutation.liveRevision !== state.liveRevision
      ? "updated"
      : "continued";

  return {
    state: { ...state, ...mutation },
    status: "applied",
    signal,
  };
}

function reduceAction(state: LabState, action: LabActionId): ActionResult {
  const allowed = availability(state, action);
  if (!allowed.available) {
    return {
      state,
      status: "blocked",
      reason: allowed.reason,
      signal: state.steps.some((value) => value === null) ? "held-last-good" : "continued",
    };
  }

  switch (action) {
    case "focus.prev":
      return { state: { ...state, focus: state.focus - 1 }, status: "applied", signal: "continued" };
    case "focus.next":
      return { state: { ...state, focus: state.focus + 1 }, status: "applied", signal: "continued" };
    case "edit.transposePrev": {
      const steps = [...state.steps];
      [steps[state.focus - 1], steps[state.focus]] = [steps[state.focus], steps[state.focus - 1]];
      return mutationResult(state, steps, state.focus - 1);
    }
    case "edit.transposeNext": {
      const steps = [...state.steps];
      [steps[state.focus], steps[state.focus + 1]] = [steps[state.focus + 1], steps[state.focus]];
      return mutationResult(state, steps, state.focus + 1);
    }
    case "value.decrease":
    case "value.increase": {
      const steps = [...state.steps];
      const delta = action === "value.increase" ? 0.1 : -0.1;
      steps[state.focus] = Number(Math.max(0, Math.min(1, (steps[state.focus] ?? 0) + delta)).toFixed(1));
      return mutationResult(state, steps, state.focus);
    }
    case "structure.makeHole": {
      const steps = [...state.steps];
      steps[state.focus] = null;
      return mutationResult(state, steps, state.focus);
    }
    case "structure.fillHole": {
      const steps = [...state.steps];
      steps[state.focus] = 0.5;
      return mutationResult(state, steps, state.focus);
    }
    case "history.undo": {
      const previous = state.history[state.history.length - 1];
      const liveChanged = previous.liveSteps.some((value, index) => value !== state.liveSteps[index]);
      return {
        state: {
          ...state,
          ...previous,
          history: state.history.slice(0, -1),
        },
        status: "applied",
        signal: previous.steps.some((value) => value === null)
          ? "held-last-good"
          : liveChanged
            ? "updated"
            : "continued",
      };
    }
    case "program.commit":
      if (state.steps.every((value, index) => value === state.liveSteps[index])) {
        return { state, status: "applied", signal: "continued" };
      }
      return {
        state: {
          ...state,
          liveSteps: state.steps as readonly number[],
          liveRevision: state.liveRevision + 1,
        },
        status: "applied",
        signal: "updated",
      };
  }
}

export function invokeAction(
  state: LabState,
  action: LabActionId,
  input: {
    readonly device: Device;
    readonly gesture: string;
    readonly t: number;
    readonly profile?: MotorProfile["id"];
    readonly inputMode?: InputMode;
  },
): LabState {
  const before = formatSteps(state.steps);
  const focusBefore = state.focus;
  const result = reduceAction(state, action);
  const event: TraceEvent = {
    seq: state.nextSeq,
    t: input.t,
    device: input.device,
    gesture: input.gesture,
    action,
    status: result.status,
    reason: result.reason,
    before,
    after: formatSteps(result.state.steps),
    focusBefore,
    focusAfter: result.state.focus,
    signal: result.signal,
    profile: input.profile ?? "direct",
    inputMode: input.inputMode ?? "keyboard",
  };

  const completedAt = state.completedAt ?? (
    !isComplete(state) && isComplete(result.state) ? input.t : null
  );

  return {
    ...result.state,
    trace: [...state.trace, event],
    nextSeq: state.nextSeq + 1,
    completedAt,
  };
}

export function recordUnbound(
  state: LabState,
  input: {
    readonly device: Device;
    readonly gesture: string;
    readonly t: number;
    readonly reason?: string;
    readonly profile?: MotorProfile["id"];
    readonly inputMode?: InputMode;
  },
): LabState {
  const event: TraceEvent = {
    seq: state.nextSeq,
    t: input.t,
    device: input.device,
    gesture: input.gesture,
    action: null,
    status: "unbound",
    reason: input.reason ?? "This gesture has no meaning in the active profile and context.",
    before: formatSteps(state.steps),
    after: formatSteps(state.steps),
    focusBefore: state.focus,
    focusAfter: state.focus,
    signal: state.steps.some((value) => value === null) ? "held-last-good" : "continued",
    profile: input.profile ?? "direct",
    inputMode: input.inputMode ?? "keyboard",
  };

  return {
    ...state,
    trace: [...state.trace, event],
    nextSeq: state.nextSeq + 1,
  };
}

export function recordRawInput(
  state: LabState,
  input: Omit<RawInputEvent, "seq">,
): LabState {
  return {
    ...state,
    rawInputs: [...state.rawInputs, { ...input, seq: state.nextRawSeq }],
    nextRawSeq: state.nextRawSeq + 1,
  };
}

export function guidanceFor(
  state: LabState,
  profile: MotorProfile,
  mode: InputMode,
  actionId: LabActionId,
): Guidance {
  const allowed = availability(state, actionId);
  const preview = reduceAction(state, actionId);
  return {
    action: ACTIONS[actionId],
    gesture: bindingFor(profile, actionId, mode),
    available: allowed.available,
    reason: allowed.reason,
    previewBefore: formatSteps(state.steps),
    previewAfter: formatSteps(preview.state.steps),
  };
}

export function analyzeRun(
  state: LabState,
  profile: MotorProfile,
  mode: InputMode,
  now: number,
): RunSummary {
  const motorTrace = state.trace.filter((event) => event.device !== "guide");
  const corrections = motorTrace.filter((event, index) => {
    if (event.action !== "history.undo" || event.status !== "applied") return false;
    const previous = motorTrace[index - 1];
    return Boolean(previous && event.t - previous.t <= 2000);
  }).length;
  const modes = new Set(motorTrace.map((event) => event.inputMode));
  const device = modes.size > 1 ? "mixed" : modes.values().next().value ?? mode;

  return {
    profile: profile.id,
    profileLabel: profile.label,
    elapsedMs: Math.max(0, (state.completedAt ?? now) - state.startedAt),
    appliedActions: motorTrace.filter((event) => event.status === "applied").length,
    corrections,
    blocked: state.trace.filter((event) => event.status === "blocked").length,
    unbound: state.trace.filter((event) => event.status === "unbound").length,
    device,
    assisted: state.trace.filter((event) => event.device === "guide" && event.status === "applied").length,
    pointerSelections: state.rawInputs.filter((event) => event.device === "onscreen" && event.control.startsWith("Select step ")).length,
  };
}

export function waveformPath(steps: readonly number[], width = 640, height = 164): string {
  const cell = width / steps.length;
  const y = (value: number) => 16 + (1 - value) * (height - 32);
  let path = `M 0 ${y(steps[0])}`;
  steps.forEach((value, index) => {
    const right = (index + 1) * cell;
    path += ` H ${right}`;
    if (index < steps.length - 1) path += ` V ${y(steps[index + 1])}`;
  });
  return path;
}
