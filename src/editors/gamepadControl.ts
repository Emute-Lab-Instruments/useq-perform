import type { EditorView } from "@codemirror/view";
import type { EditorState } from "@codemirror/state";
import type { SyntaxNode } from "@lezer/common";
import {
  createGamepadManager,
  createEmptyGamepadState,
  cloneSnapshot,
  type GamepadManager,
  type GamepadSnapshot,
  type ButtonState,
} from "../lib/gamepadManager.ts";
import {
  navigateIn,
  navigateNext,
  navigateOut,
  navigatePrev,
  navigateRight,
  navigateLeft,
  navigateUp,
  navigateDown,
  findNodeAt,
} from "./extensions/structure/new-structure.ts";
import { getTrimmedRange, performNavigation } from "./extensions/structure.ts";
import { open as openDoubleRadialMenu } from "../ui/adapters/double-radial-menu.tsx";
import { buildHierarchicalMenuModel } from "../lib/pickerMenuModel.ts";
import { evalNow } from "./editorConfig.ts";
import {
  showPickerMenu,
  showNumberPickerMenu,
  showHierarchicalGridPicker
} from "../ui/adapters/picker-menu.tsx";
import { sendSerialInputStreamValue } from "../transport/json-protocol.ts";
import {
  clearManualControlBinding,
  getManualControlBinding,
  setManualControlBinding,
  slotForStick,
  type ManualControlBinding,
} from "../lib/manualControlState.ts";
import type { PickerEntry } from "../ui/DoubleRadialPicker.tsx";
import type { HierarchicalCategory, HierarchicalItem } from "../ui/HierarchicalPickerMenu.tsx";

// ---------------------------------------------------------------------------
// Upstream modules are @ts-nocheck, so their exports are implicitly `any`.
// We cast navigation functions to a known shape so this file stays type-safe.
// ---------------------------------------------------------------------------
type NavigationFn = (state: EditorState) => EditorState;
const typedNavigateIn = navigateIn as NavigationFn;
const typedNavigateOut = navigateOut as NavigationFn;
const typedNavigateUp = navigateUp as NavigationFn;
const typedNavigateDown = navigateDown as NavigationFn;
const typedNavigateLeft = navigateLeft as NavigationFn;
const typedNavigateRight = navigateRight as NavigationFn;
const typedNavigateNext = navigateNext as NavigationFn;
const typedNavigatePrev = navigatePrev as NavigationFn;

const typedFindNodeAt = findNodeAt as (
  state: EditorState,
  from: number,
  to?: number
) => SyntaxNode | null;

const typedGetTrimmedRange = getTrimmedRange as (
  node: SyntaxNode,
  state: EditorState
) => { from: number; to: number } | null;

const typedPerformNavigation = performNavigation as (
  view: EditorView,
  navFn: NavigationFn
) => boolean;

const typedEvalNow = evalNow as (opts: {
  state: EditorState;
  view?: EditorView;
}) => boolean;

const typedBuildHierarchicalMenuModel = buildHierarchicalMenuModel as () => Promise<
  HierarchicalCategory[]
>;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL = 50;
const DEFAULT_REPEAT_CONFIG: RepeatConfig = {
  initialDelay: 300,
  repeatInterval: 60
};

const MANUAL_CONTROL_SEND_HZ = 30;
const MANUAL_CONTROL_SEND_INTERVAL_MS = Math.ceil(1000 / MANUAL_CONTROL_SEND_HZ);
const MANUAL_CONTROL_EPSILON = 1e-6;
const MANUAL_CONTROL_AXIS_DEADZONE = 0.12;

const noop = (): void => {};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Logger {
  debug: (...args: unknown[]) => void;
  info: (...args: unknown[]) => void;
  warn: (...args: unknown[]) => void;
  error: (...args: unknown[]) => void;
}

interface Scheduler {
  set(callback: () => void, interval: number): ReturnType<typeof setInterval>;
  clear(handle: ReturnType<typeof setInterval>): void;
}

interface RepeatConfig {
  initialDelay: number;
  repeatInterval: number;
}

interface ButtonRepeatState {
  pressedAt: number;
  lastRepeat: number;
}

type ControllerMode = "normal" | "picker" | "number-picker" | "loading-picker";
type NavigationMode = "spatial" | "structural";

interface PickerState {
  direction: string;
  closeMenu: (() => void) | null;
}

interface NumberPickerState {
  direction: string;
  closeMenu: (() => void) | null;
}

interface ControllerState {
  mode: ControllerMode;
  picker: PickerState | null;
  numberPicker: NumberPickerState | null;
  navigationMode: NavigationMode;
  buttonRepeat: Record<string, ButtonRepeatState>;
  prevSnapshot: GamepadSnapshot;
}

/** Union of PickerEntry (radial) and HierarchicalItem (grid) — both share the same index signature. */
type MenuEntry = PickerEntry | HierarchicalItem;

type PickerSelectHandler = (
  entry: MenuEntry,
  index: number,
  direction: string
) => void;

interface PickerUI {
  showMenu: typeof showPickerMenu;
  showNumberMenu: typeof showNumberPickerMenu;
}

interface GamepadControllerOptions {
  view: EditorView;
  gamepadManager?: GamepadManager;
  scheduler?: Scheduler;
  now?: () => number;
  logger?: Logger;
  pollInterval?: number;
  repeatConfig?: Partial<RepeatConfig>;
  pickerUI?: Partial<PickerUI>;
  eventTarget?: EventTarget | null;
  onPickerSelect?: PickerSelectHandler | null;
}

interface StickVectors {
  leftStick: { x: number; y: number };
  rightStick: { x: number; y: number };
}

interface CommandEntry {
  combo: string[];
  mode: ControllerMode;
  action: (controller: GamepadController) => void;
}

// ---------------------------------------------------------------------------
// Statics
// ---------------------------------------------------------------------------

const nullLogger: Logger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop
};

const defaultScheduler: Scheduler = {
  set(callback: () => void, interval: number) {
    return setInterval(callback, interval);
  },
  clear(handle: ReturnType<typeof setInterval>) {
    clearInterval(handle);
  }
};

const defaultEventTarget: EventTarget | null =
  typeof window !== "undefined" ? window : null;

const COMMAND_REGISTRY: CommandEntry[] = [
  {
    combo: ["LB", "A"],
    mode: "normal",
    action: (controller) => controller.openCreateMenu("before")
  },
  {
    combo: ["RB", "A"],
    mode: "normal",
    action: (controller) => controller.openCreateMenu("after")
  },
  {
    combo: ["X"],
    mode: "normal",
    action: (controller) => controller.openDoubleRadialCreateMenu("replace")
  },
  {
    combo: ["Y"],
    mode: "normal",
    action: (controller) => controller.deleteNode()
  },
  {
    combo: ["Start"],
    mode: "normal",
    action: (controller) => controller.runEvalNow()
  },
  {
    combo: ["Back"],
    mode: "normal",
    action: (controller) => controller.toggleNavigationMode()
  }
];

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function cloneGamepadSnapshot(snapshot: GamepadSnapshot | null): GamepadSnapshot {
  const cloned = cloneSnapshot(snapshot);
  if (cloned) return cloned;
  return {
    connected: false,
    id: "",
    index: null,
    timestamp: 0,
    buttons: {},
    axes: {}
  };
}

function isNewPress(
  buttonName: string,
  snapshot: GamepadSnapshot | null,
  prevSnapshot: GamepadSnapshot | null
): boolean {
  const nextPressed = Boolean(snapshot?.buttons?.[buttonName]?.pressed);
  const prevPressed = Boolean(prevSnapshot?.buttons?.[buttonName]?.pressed);
  return nextPressed && !prevPressed;
}

function isButtonPressed(
  buttonName: string,
  snapshot: GamepadSnapshot | null
): boolean {
  return Boolean(snapshot?.buttons?.[buttonName]?.pressed);
}

function pressedButtons(snapshot: GamepadSnapshot | null): string[] {
  return Object.entries(snapshot?.buttons || {})
    .filter(([, value]) => Boolean((value as ButtonState)?.pressed))
    .map(([name]) => name);
}

function computeRepeatState(
  previousState: ButtonRepeatState | undefined,
  now: number,
  config: RepeatConfig
): { shouldTrigger: boolean; state: ButtonRepeatState } {
  if (!previousState) {
    return {
      shouldTrigger: true,
      state: { pressedAt: now, lastRepeat: now }
    };
  }

  const elapsed = now - previousState.pressedAt;
  const sinceLast = now - previousState.lastRepeat;

  if (elapsed >= config.initialDelay && sinceLast >= config.repeatInterval) {
    return {
      shouldTrigger: true,
      state: { pressedAt: previousState.pressedAt, lastRepeat: now }
    };
  }

  return {
    shouldTrigger: false,
    state: previousState
  };
}

function resolvePickerDirection(
  snapshot: GamepadSnapshot,
  prevSnapshot: GamepadSnapshot
): string | null {
  if (isNewPress("Left", snapshot, prevSnapshot)) return "left";
  if (isNewPress("Right", snapshot, prevSnapshot)) return "right";
  if (isNewPress("Up", snapshot, prevSnapshot)) return "up";
  if (isNewPress("Down", snapshot, prevSnapshot)) return "down";
  return null;
}

function resolveStickVectors(snapshot: GamepadSnapshot | null): StickVectors {
  const lx = Number(snapshot?.axes?.LeftStickX || 0);
  const ly = Number(snapshot?.axes?.LeftStickY || 0);
  const rx = Number(snapshot?.axes?.RightStickX || 0);
  const ry = Number(snapshot?.axes?.RightStickY || 0);
  return {
    leftStick: { x: lx, y: ly },
    rightStick: { x: rx, y: ry }
  };
}

function dispatchPickerEvent(
  target: EventTarget | null,
  detail: Record<string, unknown>,
  logger: Logger
): void {
  if (!target || typeof target.dispatchEvent !== "function") return;
  const event =
    typeof CustomEvent === "function"
      ? new CustomEvent("gamepadpickerinput", { detail })
      : ({ type: "gamepadpickerinput", detail } as unknown as Event);
  try {
    target.dispatchEvent(event);
  } catch (error) {
    logger.warn?.("Failed to dispatch picker event", error);
  }
}

function getCursorNode(view: EditorView): SyntaxNode | null {
  if (!view) return null;
  const selection = view.state.selection.main;
  return typedFindNodeAt(view.state, selection.from, selection.to);
}

function deleteNodeAtCursor(view: EditorView): boolean {
  if (!view) return false;
  const state = view.state;
  const node = getCursorNode(view);
  if (!node) return false;
  const range = typedGetTrimmedRange(node, state);
  if (!range) return false;

  const doc = state.doc;
  let whitespaceEnd = range.to;
  const docLen = doc.length;
  while (whitespaceEnd < docLen) {
    const ch = doc.sliceString(whitespaceEnd, whitespaceEnd + 1);
    if (ch === " " || ch === "\t") {
      whitespaceEnd += 1;
    } else if (ch === "\n") {
      whitespaceEnd += 1;
      break;
    } else {
      break;
    }
  }

  view.dispatch({
    changes: { from: range.from, to: whitespaceEnd, insert: "" },
    selection: { anchor: range.from },
    scrollIntoView: true,
    userEvent: "delete.node"
  });
  return true;
}

function isNumberNode(node: SyntaxNode | null): boolean {
  return node != null && (node.type?.name === "Number" || (node.type as unknown) === "Number");
}

function getNumberNodeValue(node: SyntaxNode, state: EditorState): number | null {
  if (typeof node.from !== "number" || typeof node.to !== "number") return null;
  const text = state.doc.sliceString(node.from, node.to);
  const num = Number(text);
  return Number.isNaN(num) ? null : num;
}

function setNumberNodeValue(view: EditorView, node: SyntaxNode, value: number): void {
  if (!view) return;
  if (typeof node.from !== "number" || typeof node.to !== "number") return;
  const doc = view.state.doc;
  const originalText = doc.sliceString(node.from, node.to);
  const match = originalText.match(/^(\s*)(.*?)(\s*)$/);
  const leading = match ? match[1] : "";
  const trailing = match ? match[3] : "";
  const newText = `${leading}${value}${trailing}`;

  view.dispatch({
    changes: { from: node.from, to: node.to, insert: newText },
    selection: { anchor: node.from + leading.length },
    scrollIntoView: true,
    userEvent: "edit.number"
  });
}

function formatManualControlNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (Object.is(value, -0)) value = 0;
  const abs = Math.abs(value);
  let text: string;
  if (abs === 0) {
    text = "0";
  } else if (abs < 0.001) {
    text = value.toExponential(3);
  } else if (abs < 100) {
    text = value.toFixed(4);
  } else if (abs < 10000) {
    text = value.toFixed(2);
  } else {
    text = String(Math.round(value));
  }

  if (text.includes(".") && !text.includes("e")) {
    text = text.replace(/\.?0+$/, "");
  }
  return text;
}

function getNodeRangeAtCursor(view: EditorView): { from: number; to: number } | null {
  if (!view) return null;
  const node = getCursorNode(view);
  if (!node) return null;
  const range = typedGetTrimmedRange(node, view.state) || node;
  if (typeof range?.from !== "number" || typeof range?.to !== "number") return null;
  return { from: range.from, to: range.to };
}

function getNumericSeedFromText(text: string): number | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const num = Number(trimmed);
  return Number.isFinite(num) ? num : null;
}

function adjustNumberAtCursor(view: EditorView, delta: number): boolean {
  if (!view) return false;
  const state = view.state;
  const node = getCursorNode(view);
  if (!node || !isNumberNode(node)) return false;
  const currentValue = getNumberNodeValue(node, state);
  if (currentValue === null) return false;
  setNumberNodeValue(view, node, currentValue + delta);
  return true;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

class GamepadController {
  private view: EditorView;
  private gamepadManager: GamepadManager;
  private scheduler: Scheduler;
  private now: () => number;
  private logger: Logger;
  private pollInterval: number;
  private repeatConfig: RepeatConfig;
  private pickerUI: PickerUI;
  private eventTarget: EventTarget | null;
  private onPickerSelect: PickerSelectHandler | null;

  private state: ControllerState;
  private intervalId: ReturnType<typeof setInterval> | null;
  private started: boolean;
  private pointerListener: () => void;

  constructor({
    view,
    gamepadManager = createGamepadManager(),
    scheduler = defaultScheduler,
    now = () => Date.now(),
    logger = nullLogger,
    pollInterval = DEFAULT_POLL_INTERVAL,
    repeatConfig = DEFAULT_REPEAT_CONFIG,
    pickerUI = {
      showMenu: showPickerMenu,
      showNumberMenu: showNumberPickerMenu
    },
    eventTarget = defaultEventTarget,
    onPickerSelect = null
  }: GamepadControllerOptions) {
    this.view = view;
    this.gamepadManager = gamepadManager;
    this.scheduler = scheduler;
    this.now = now;
    this.logger = logger ?? nullLogger;
    this.pollInterval = pollInterval;
    this.repeatConfig = {
      initialDelay: repeatConfig.initialDelay ?? DEFAULT_REPEAT_CONFIG.initialDelay,
      repeatInterval: repeatConfig.repeatInterval ?? DEFAULT_REPEAT_CONFIG.repeatInterval
    };
    this.pickerUI = {
      showMenu: pickerUI?.showMenu ?? showPickerMenu,
      showNumberMenu: pickerUI?.showNumberMenu ?? showNumberPickerMenu
    };
    this.eventTarget = eventTarget;
    this.onPickerSelect = typeof onPickerSelect === "function" ? onPickerSelect : null;

    this.state = {
      mode: "normal",
      picker: null,
      numberPicker: null,
      navigationMode: "spatial",
      buttonRepeat: {},
      prevSnapshot: cloneGamepadSnapshot(createEmptyGamepadState({ now: this.now }))
    };

    this.intervalId = null;
    this.started = false;
    this.pointerListener = () => this.showEditorCursor();
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    if (this.view?.dom) {
      this.view.dom.addEventListener("pointerdown", this.pointerListener);
    }
    this.gamepadManager.connect();
    this.intervalId = this.scheduler.set(() => this.tick(), this.pollInterval);
    this.tick();
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.intervalId !== null) {
      this.scheduler.clear(this.intervalId);
      this.intervalId = null;
    }
    if (this.view?.dom) {
      this.view.dom.removeEventListener("pointerdown", this.pointerListener);
    }
    this.gamepadManager.disconnect();
  }

  dispose(): void {
    this.stop();
    this.gamepadManager.reset();
  }

  getState(): ControllerState {
    return {
      ...this.state,
      buttonRepeat: { ...this.state.buttonRepeat },
      prevSnapshot: cloneGamepadSnapshot(this.state.prevSnapshot)
    };
  }

  // -- Tick & dispatch ------------------------------------------------------

  private tick(): void {
    const snapshot = this.gamepadManager.poll();
    this.processSnapshot(snapshot);
  }

  processSnapshot(snapshot: GamepadSnapshot | null): void {
    const prevSnapshot = this.state.prevSnapshot;

    if (!snapshot?.connected) {
      this.state.buttonRepeat = {};
      this.state.prevSnapshot = cloneGamepadSnapshot(snapshot);
      return;
    }

    if (this.state.mode === "picker" || this.state.mode === "number-picker") {
      this.state.buttonRepeat = {};
      this.handlePickerNavigation(snapshot, prevSnapshot);
    } else {
      this.handleNavigation(snapshot, prevSnapshot);
    }

    if (this.state.mode === "normal") {
      this.handleNumberAdjustment(snapshot, prevSnapshot);
      this.handleManualControl(snapshot, prevSnapshot);
      this.handleButtonCommands(snapshot, prevSnapshot);
    }

    this.state.prevSnapshot = cloneGamepadSnapshot(snapshot);
  }

  // -- Normal-mode navigation -----------------------------------------------

  private handleNavigation(
    snapshot: GamepadSnapshot,
    prevSnapshot: GamepadSnapshot
  ): void {
    if (!this.view) return;
    const now = this.now();
    const navigationMap: Record<string, NavigationFn> =
      this.state.navigationMode === "spatial"
        ? {
            Up: typedNavigateUp,
            Down: typedNavigateDown,
            Left: typedNavigateLeft,
            Right: typedNavigateRight
          }
        : {
            Up: typedNavigatePrev,
            Down: typedNavigateNext,
            Left: typedNavigatePrev,
            Right: typedNavigateNext
          };

    for (const [button, handler] of Object.entries(navigationMap)) {
      this.applyNavigation(button, handler, snapshot, now);
    }

    if (isNewPress("A", snapshot, prevSnapshot)) {
      if (typedPerformNavigation(this.view, typedNavigateIn)) {
        this.hideEditorCursor();
      }
    }
    if (isNewPress("B", snapshot, prevSnapshot)) {
      if (typedPerformNavigation(this.view, typedNavigateOut)) {
        this.hideEditorCursor();
      }
    }
  }

  private applyNavigation(
    button: string,
    handler: NavigationFn,
    snapshot: GamepadSnapshot,
    now: number
  ): void {
    if (!isButtonPressed(button, snapshot)) {
      if (this.state.buttonRepeat[button]) {
        delete this.state.buttonRepeat[button];
      }
      return;
    }

    const repeat = computeRepeatState(
      this.state.buttonRepeat[button],
      now,
      this.repeatConfig
    );
    this.state.buttonRepeat[button] = repeat.state;
    if (!repeat.shouldTrigger) return;

    if (typedPerformNavigation(this.view, handler)) {
      this.hideEditorCursor();
    }
  }

  // -- Picker-mode navigation -----------------------------------------------

  private handlePickerNavigation(
    snapshot: GamepadSnapshot,
    prevSnapshot: GamepadSnapshot
  ): void {
    if (this.state.mode !== "picker" && this.state.mode !== "number-picker") return;
    const direction = resolvePickerDirection(snapshot, prevSnapshot);
    const sticks = resolveStickVectors(snapshot);
    if (direction) {
      dispatchPickerEvent(this.eventTarget, { direction, ...sticks }, this.logger);
    } else {
      dispatchPickerEvent(this.eventTarget, { ...sticks }, this.logger);
    }

    if (isNewPress("A", snapshot, prevSnapshot)) {
      dispatchPickerEvent(this.eventTarget, { action: "select" }, this.logger);
    } else if (
      isNewPress("B", snapshot, prevSnapshot) ||
      isNewPress("Back", snapshot, prevSnapshot)
    ) {
      dispatchPickerEvent(this.eventTarget, { action: "cancel" }, this.logger);
      this.cancelAction();
    }

    // Trigger buttons for double radial menu actions
    if (this.state.picker?.direction === "replace") {
      if (isNewPress("RB", snapshot, prevSnapshot)) {
        dispatchPickerEvent(
          this.eventTarget,
          { action: "apply", mode: "replace" },
          this.logger
        );
      } else if (isNewPress("RT", snapshot, prevSnapshot)) {
        dispatchPickerEvent(
          this.eventTarget,
          { action: "apply", mode: "apply_call" },
          this.logger
        );
      } else if (isNewPress("LB", snapshot, prevSnapshot)) {
        dispatchPickerEvent(
          this.eventTarget,
          { action: "apply", mode: "apply_pre" },
          this.logger
        );
      } else if (isNewPress("LT", snapshot, prevSnapshot)) {
        dispatchPickerEvent(
          this.eventTarget,
          { action: "apply", mode: "apply" },
          this.logger
        );
      }
    }
  }

  // -- Number adjustment ----------------------------------------------------

  private handleNumberAdjustment(
    snapshot: GamepadSnapshot,
    prevSnapshot: GamepadSnapshot
  ): void {
    if (!this.view) return;
    if (isNewPress("LB", snapshot, prevSnapshot)) {
      const adjusted = adjustNumberAtCursor(this.view, -1);
      if (adjusted) this.hideEditorCursor();
    } else if (isNewPress("RB", snapshot, prevSnapshot)) {
      const adjusted = adjustNumberAtCursor(this.view, 1);
      if (adjusted) this.hideEditorCursor();
    }
  }

  // -- Manual control -------------------------------------------------------

  private handleManualControl(
    snapshot: GamepadSnapshot,
    prevSnapshot: GamepadSnapshot
  ): void {
    if (!this.view) return;

    const now = this.now();

    if (isNewPress("LeftStickPress", snapshot, prevSnapshot)) {
      this.toggleManualControl("left", now);
    }
    if (isNewPress("RightStickPress", snapshot, prevSnapshot)) {
      this.toggleManualControl("right", now);
    }

    this.updateManualControl("left", snapshot, now);
    this.updateManualControl("right", snapshot, now);
  }

  private toggleManualControl(stick: "left" | "right", _nowMs: number): void {
    const existing = getManualControlBinding(stick);
    if (existing) {
      clearManualControlBinding(stick);
      return;
    }

    const range = getNodeRangeAtCursor(this.view);
    if (!range) return;

    const originalText = this.view.state.doc.sliceString(range.from, range.to);
    const seed = getNumericSeedFromText(originalText);
    const value = seed ?? 0;
    const slot = slotForStick(stick);

    const text = formatManualControlNumber(value);
    this.view.dispatch({
      changes: { from: range.from, to: range.to, insert: text },
      selection: { anchor: range.from + text.length },
      scrollIntoView: true,
      userEvent: "manualControl.bind"
    });
    this.hideEditorCursor();

    const binding: ManualControlBinding = {
      stick,
      slot,
      from: range.from,
      to: range.from + text.length,
      value,
      originalText,
      lastSentAt: 0,
      lastSentValue: NaN
    };
    setManualControlBinding(stick, binding);

    sendSerialInputStreamValue(slot, value).catch(() => {});
  }

  private updateManualControl(
    stick: "left" | "right",
    snapshot: GamepadSnapshot,
    nowMs: number
  ): void {
    const binding = getManualControlBinding(stick);
    if (!binding) return;

    if (binding.lastSentAt && nowMs - binding.lastSentAt < MANUAL_CONTROL_SEND_INTERVAL_MS) {
      return;
    }

    const axisX = Number(
      snapshot?.axes?.[stick === "right" ? "RightStickX" : "LeftStickX"] || 0
    );
    const axisY = Number(
      snapshot?.axes?.[stick === "right" ? "RightStickY" : "LeftStickY"] || 0
    );

    const x = Math.abs(axisX) < MANUAL_CONTROL_AXIS_DEADZONE ? 0 : axisX;
    const y = Math.abs(axisY) < MANUAL_CONTROL_AXIS_DEADZONE ? 0 : axisY;

    if (x === 0 && y === 0) {
      binding.lastSentAt = nowMs;
      return;
    }

    const base = 0.01 * Math.max(1, Math.abs(binding.value));
    const k = 3; // ~3 decades over full stick travel
    const sensitivity = base * Math.pow(10, k * x);
    const nextValue = binding.value + -y * sensitivity;

    if (
      Number.isFinite(binding.lastSentValue) &&
      Math.abs(nextValue - binding.lastSentValue) < MANUAL_CONTROL_EPSILON
    ) {
      binding.lastSentAt = nowMs;
      return;
    }

    binding.value = nextValue;
    binding.lastSentValue = nextValue;
    binding.lastSentAt = nowMs;

    const text = formatManualControlNumber(nextValue);

    this.view.dispatch({
      changes: { from: binding.from, to: binding.to, insert: text },
      selection: { anchor: binding.from + text.length },
      scrollIntoView: false,
      userEvent: "manualControl.update"
    });
    binding.to = binding.from + text.length;

    sendSerialInputStreamValue(binding.slot, nextValue).catch(() => {});
  }

  // -- Button commands ------------------------------------------------------

  private handleButtonCommands(
    snapshot: GamepadSnapshot,
    prevSnapshot: GamepadSnapshot
  ): void {
    const pressed = pressedButtons(snapshot);
    if (pressed.length === 0) return;

    for (const command of COMMAND_REGISTRY) {
      if (command.mode && command.mode !== this.state.mode) continue;
      if (!this.isComboTriggered(command.combo, snapshot, prevSnapshot)) continue;
      command.action(this);
    }
  }

  private isComboTriggered(
    combo: string[],
    snapshot: GamepadSnapshot,
    prevSnapshot: GamepadSnapshot
  ): boolean {
    return (
      combo.every((button) => isButtonPressed(button, snapshot)) &&
      combo.some((button) => isNewPress(button, snapshot, prevSnapshot))
    );
  }

  // -- Editor cursor helpers ------------------------------------------------

  private showEditorCursor(): void {
    if (this.view?.dom) {
      this.view.dom.classList.remove("hide-cursor");
    }
  }

  private hideEditorCursor(): void {
    if (this.view?.dom) {
      this.view.dom.classList.add("hide-cursor");
    }
  }

  // -- Menus ----------------------------------------------------------------

  async openCreateMenu(direction: string): Promise<void> {
    if (this.state.mode === "picker" || this.state.mode === "loading-picker") {
      this.logger.debug?.("[gamepadControl] Picker already open; ignoring create menu request");
      return;
    }

    this.state.mode = "loading-picker";
    const categories = await typedBuildHierarchicalMenuModel();

    // User may have cancelled during the async load
    if (this.state.mode !== "loading-picker") {
      return;
    }

    const closeMenu = showHierarchicalGridPicker({
      categories,
      title: "Create",
      onSelect: (entry: HierarchicalItem) =>
        this.handleCreateSelection(entry, direction)
    });

    this.state.mode = "picker";
    this.state.picker = { direction, closeMenu };
  }

  async openDoubleRadialCreateMenu(direction: string): Promise<void> {
    if (this.state.mode === "picker" || this.state.mode === "loading-picker") {
      this.logger.debug?.("[gamepadControl] Picker already open; ignoring create menu request");
      return;
    }

    this.state.mode = "loading-picker";
    const categories = await typedBuildHierarchicalMenuModel();

    // User may have cancelled during the async load
    if (this.state.mode !== "loading-picker") {
      return;
    }

    const closeMenu = openDoubleRadialMenu({
      categories: categories as unknown as import("../../ui/DoubleRadialPicker.tsx").PickerCategory[],
      title: "Create",
      onSelect: (entry: PickerEntry) =>
        this.handleCreateSelection(entry, direction),
      onCancel: () => this.cancelAction()
    });

    this.state.mode = "picker";
    this.state.picker = { direction, closeMenu };
  }

  private handleCreateSelection(entry: MenuEntry, direction: string): void {
    if (this.onPickerSelect) {
      this.onPickerSelect(entry, 0, direction);
      this.state.mode = "normal";
      this.state.picker = null;
      return;
    }

    const view = this.view;
    if (!view) {
      this.state.mode = "normal";
      this.state.picker = null;
      return;
    }

    const text =
      entry && (entry as PickerEntry).insertText
        ? (entry as PickerEntry).insertText!
        : String(entry?.value ?? "");
    if (!text) {
      this.state.mode = "normal";
      this.state.picker = null;
      return;
    }

    const applyMode =
      (entry as Record<string, unknown>).applyMode as string | undefined ??
      (direction === "replace"
        ? "replace"
        : direction === "before"
          ? "apply_pre"
          : "apply");
    const symbol = text.trim();

    try {
      const node = getCursorNode(view);
      const range = node
        ? typedGetTrimmedRange(node, view.state)
        : view.state.selection.main;
      const from =
        typeof range?.from === "number" ? range.from : view.state.selection.main.from;
      const to =
        typeof range?.to === "number" ? range.to : view.state.selection.main.to;

      switch (applyMode) {
        case "replace":
          view.dispatch({
            changes: { from, to, insert: symbol },
            selection: { anchor: from + symbol.length },
            scrollIntoView: true,
            userEvent: "replace.picker"
          });
          break;

        case "apply_call": {
          const funcCall = ` (${symbol} _)`;
          view.dispatch({
            changes: { from: to, to, insert: funcCall },
            selection: { anchor: to + funcCall.indexOf("_") },
            scrollIntoView: true,
            userEvent: "insert.call.picker"
          });
          break;
        }

        case "apply_pre":
          view.dispatch({
            changes: { from, to: from, insert: symbol + " " },
            selection: { anchor: from },
            scrollIntoView: true,
            userEvent: "insert.before.picker"
          });
          break;

        case "apply":
        default:
          view.dispatch({
            changes: { from: to, to, insert: " " + symbol },
            selection: { anchor: to + 1 },
            scrollIntoView: true,
            userEvent: "insert.after.picker"
          });
          break;
      }
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error?.(`[gamepadControl] Error applying selection: ${message}`);
      view.dispatch({
        changes: {
          from: view.state.selection.main.from,
          to: view.state.selection.main.to,
          insert: text
        },
        selection: { anchor: view.state.selection.main.from + text.length },
        scrollIntoView: true,
        userEvent: "insert.picker.fallback"
      });
    }

    this.state.mode = "normal";
    this.state.picker = null;
    this.hideEditorCursor();
  }

  openNumberPicker(direction: string): void {
    this.state.mode = "number-picker";
    const closeMenu = this.pickerUI.showNumberMenu({
      title: "Pick a Number",
      initialValue: 0,
      min: -9999,
      max: 9999,
      step: 1,
      onSelect: (value: number) => {
        this.state.mode = "normal";
        this.state.numberPicker = null;
        if (this.onPickerSelect) {
          this.onPickerSelect(
            { label: String(value), value } as MenuEntry,
            0,
            direction
          );
        }
      }
    });

    this.state.numberPicker = { direction, closeMenu };
  }

  cancelAction(): void {
    if (this.state.mode === "picker" && this.state.picker?.closeMenu) {
      this.state.picker.closeMenu();
    }
    if (this.state.mode === "number-picker" && this.state.numberPicker?.closeMenu) {
      this.state.numberPicker.closeMenu();
    }
    this.state.picker = null;
    this.state.numberPicker = null;
    this.state.mode = "normal";
  }

  /** Whether a picker menu is currently loading or open. */
  isPickerBusy(): boolean {
    return this.state.mode === "picker" || this.state.mode === "loading-picker";
  }

  deleteNode(): void {
    const removed = deleteNodeAtCursor(this.view);
    if (!removed) return;
    this.hideEditorCursor();
  }

  runEvalNow(): void {
    if (!this.view) return;
    typedEvalNow({ state: this.view.state, view: this.view });
  }

  toggleNavigationMode(): void {
    this.state.navigationMode =
      this.state.navigationMode === "structural" ? "spatial" : "structural";
    this.logger.debug?.(
      `[gamepadControl] navigationMode set to ${this.state.navigationMode}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function createGamepadController(
  options: GamepadControllerOptions
): GamepadController {
  return new GamepadController(options);
}

function getMergedGamepads(): (Gamepad | null)[] {
  if (typeof navigator === "undefined" || typeof navigator.getGamepads !== "function") {
    return [];
  }
  return Array.from(navigator.getGamepads());
}

let activeController: GamepadController | null = null;

export function initGamepadControl(
  view: EditorView,
  options: Partial<GamepadControllerOptions> = {}
): GamepadController {
  if (activeController) {
    console.debug("[gamepadControl] Disposing existing controller before initialization");
    activeController.dispose();
    activeController = null;
  }

  const gamepadManager = createGamepadManager({
    getGamepads: getMergedGamepads
  });
  const controller = createGamepadController({
    view,
    gamepadManager,
    ...options
  });
  controller.start();
  activeController = controller;
  return controller;
}
