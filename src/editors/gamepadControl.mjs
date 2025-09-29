import {
  createGamepadManager,
  createEmptyGamepadState
} from "../io/gamepad.mjs";
import {
  navigateIn,
  navigateNext,
  navigateOut,
  navigatePrev
} from "./extensions/structure/navigation.mjs";
import { nodeTreeCursorField, getTrimmedRange } from "./extensions/structure.mjs";
import { showPickerMenu, showNumberPickerMenu } from "../ui/pickerMenu.mjs";
import { showHierarchicalGridPicker } from "../ui/hierarchicalPickerMenu.mjs";
import { showRadialPickerMenu } from "../ui/radialPickerMenu.mjs";
import { buildHierarchicalMenuModel } from "../ui/pickers/menuData.mjs";
import { activeUserSettings } from "../utils/persistentUserSettings.mjs";
import { evalNow } from "./editorConfig.mjs";

const DEFAULT_POLL_INTERVAL = 50;
const DEFAULT_REPEAT_CONFIG = {
  initialDelay: 300,
  repeatInterval: 60
};

const noop = () => {};
const nullLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop
};

const defaultScheduler = {
  set(callback, interval) {
    return setInterval(callback, interval);
  },
  clear(handle) {
    clearInterval(handle);
  }
};

const defaultEventTarget = typeof window !== "undefined" ? window : null;

const createMenuOptions = [
  { name: "Number", text: "123" },
  { name: "Math", lucideIcon: "calculator" },
  { name: "Timing", lucideIcon: "clock" },
  { name: "Call", text: "()" },
  { name: "List", text: "[]" },
  { name: "IO", lucideIcon: "arrow-left-right" },
  { name: "Utils", lucideIcon: "wrench" }
];

const COMMAND_REGISTRY = [
  {
    combo: ["LB", "A"],
    mode: "normal",
    action: controller => controller.openCreateMenu("before")
  },
  {
    combo: ["RB", "A"],
    mode: "normal",
    action: controller => controller.openCreateMenu("after")
  },
  {
    combo: ["X"],
    mode: "normal",
    action: controller => controller.openCreateMenu("replace")
  },
  {
    combo: ["Y"],
    mode: "normal",
    action: controller => controller.deleteNode()
  },
  {
    combo: ["Start"],
    mode: "normal",
    action: controller => controller.runEvalNow()
  },
  {
    combo: ["Back"],
    mode: "normal",
    action: controller => controller.toggleNavigationMode()
  }
];

function cloneGamepadSnapshot(snapshot) {
  if (!snapshot) {
    return {
      connected: false,
      id: "",
      index: null,
      timestamp: 0,
      buttons: {},
      axes: {}
    };
  }
  return {
    connected: Boolean(snapshot.connected),
    id: snapshot.id || "",
    index: typeof snapshot.index === "number" ? snapshot.index : null,
    timestamp: snapshot.timestamp ?? 0,
    buttons: Object.fromEntries(
      Object.entries(snapshot.buttons || {}).map(([name, value]) => [
        name,
        {
          pressed: Boolean(value?.pressed),
          value: typeof value?.value === "number" ? value.value : 0
        }
      ])
    ),
    axes: Object.fromEntries(
      Object.entries(snapshot.axes || {}).map(([name, value]) => [
        name,
        typeof value === "number" ? value : 0
      ])
    )
  };
}

function isNewPress(buttonName, snapshot, prevSnapshot) {
  const nextPressed = Boolean(snapshot?.buttons?.[buttonName]?.pressed);
  const prevPressed = Boolean(prevSnapshot?.buttons?.[buttonName]?.pressed);
  return nextPressed && !prevPressed;
}

function isButtonPressed(buttonName, snapshot) {
  return Boolean(snapshot?.buttons?.[buttonName]?.pressed);
}

function pressedButtons(snapshot) {
  return Object.entries(snapshot?.buttons || {})
    .filter(([, value]) => Boolean(value?.pressed))
    .map(([name]) => name);
}

function computeRepeatState(previousState, now, { initialDelay, repeatInterval }) {
  if (!previousState) {
    return {
      shouldTrigger: true,
      state: {
        pressedAt: now,
        lastRepeat: now
      }
    };
  }

  const elapsed = now - previousState.pressedAt;
  const sinceLast = now - previousState.lastRepeat;

  if (elapsed >= initialDelay && sinceLast >= repeatInterval) {
    return {
      shouldTrigger: true,
      state: {
        pressedAt: previousState.pressedAt,
        lastRepeat: now
      }
    };
  }

  return {
    shouldTrigger: false,
    state: previousState
  };
}

function resolvePickerDirection(snapshot, prevSnapshot) {
  if (isNewPress("Left", snapshot, prevSnapshot)) return "left";
  if (isNewPress("Right", snapshot, prevSnapshot)) return "right";
  if (isNewPress("Up", snapshot, prevSnapshot)) return "up";
  if (isNewPress("Down", snapshot, prevSnapshot)) return "down";
  return null;
}

function resolveStickVectors(snapshot) {
  const lx = Number(snapshot?.axes?.LeftStickX || 0);
  const ly = Number(snapshot?.axes?.LeftStickY || 0);
  const rx = Number(snapshot?.axes?.RightStickX || 0);
  const ry = Number(snapshot?.axes?.RightStickY || 0);
  return {
    leftStick: { x: lx, y: ly },
    rightStick: { x: rx, y: ry }
  };
}

function dispatchPickerEvent(target, detail, logger) {
  if (!target || typeof target.dispatchEvent !== "function") return;
  const event = typeof CustomEvent === "function"
    ? new CustomEvent("gamepadpickerinput", { detail })
    : { type: "gamepadpickerinput", detail };
  try {
    target.dispatchEvent(event);
  } catch (error) {
    logger.warn?.("Failed to dispatch picker event", error);
  }
}

function getCursorNode(view) {
  if (!view) return null;
  const cursorField = view.state.field(nodeTreeCursorField, false);
  if (!cursorField || typeof cursorField.getNode !== "function") return null;
  return cursorField.getNode();
}

function deleteNodeAtCursor(view) {
  if (!view) return false;
  const state = view.state;
  const node = getCursorNode(view);
  if (!node) return false;
  const range = getTrimmedRange(node, state);
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

function isNumberNode(node) {
  return node && (node.type?.name === "Number" || node.type === "Number");
}

function getNumberNodeValue(node, state) {
  if (!node || typeof node.from !== "number" || typeof node.to !== "number") return null;
  const text = state.doc.sliceString(node.from, node.to);
  const num = Number(text);
  return Number.isNaN(num) ? null : num;
}

function setNumberNodeValue(view, node, value) {
  if (!view) return;
  if (!node || typeof node.from !== "number" || typeof node.to !== "number") return;
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

function adjustNumberAtCursor(view, delta) {
  if (!view) return false;
  const state = view.state;
  const node = getCursorNode(view);
  if (!node || !isNumberNode(node)) return false;
  const currentValue = getNumberNodeValue(node, state);
  if (currentValue === null) return false;
  setNumberNodeValue(view, node, currentValue + delta);
  return true;
}

function getNodeLineAndColumn(node, state) {
  const line = state.doc.lineAt(node.from);
  const col = node.from - line.from;
  return { line: line.number, col };
}

function getAllNodes(state) {
  const tree = state.field(nodeTreeCursorField, false)?.root;
  if (!tree) return [];
  const nodes = [];
  function visit(n) {
    if (!n) return;
    nodes.push(n);
    if (n.children) n.children.forEach(visit);
  }
  visit(tree);
  return nodes;
}

function spatialNavigateLeft(state) {
  const cursor = state.field(nodeTreeCursorField, false);
  if (!cursor) return null;
  const node = cursor.getNode?.();
  if (!node) return null;
  const { line, col } = getNodeLineAndColumn(node, state);
  const nodes = getAllNodes(state).filter(n => n !== node);
  let best = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const nLine = state.doc.lineAt(n.from).number;
    const nCol = n.from - state.doc.lineAt(n.from).from;
    if (nLine === line && n.from < node.from) {
      const dist = col - nCol;
      if (dist > 0 && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
  }
  if (best) {
    return state.update({
      selection: { anchor: best.from },
      scrollIntoView: true
    });
  }
  return null;
}

function spatialNavigateRight(state) {
  const cursor = state.field(nodeTreeCursorField, false);
  if (!cursor) return null;
  const node = cursor.getNode?.();
  if (!node) return null;
  const { line, col } = getNodeLineAndColumn(node, state);
  const nodes = getAllNodes(state).filter(n => n !== node);
  let best = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    const nLine = state.doc.lineAt(n.from).number;
    const nCol = n.from - state.doc.lineAt(n.from).from;
    if (nLine === line && n.from > node.from) {
      const dist = nCol - col;
      if (dist > 0 && dist < bestDist) {
        best = n;
        bestDist = dist;
      }
    }
  }
  if (node.children && node.children.length > 0) {
    for (const child of node.children) {
      const childLine = state.doc.lineAt(child.from).number;
      const childCol = child.from - state.doc.lineAt(child.from).from;
      if (childLine === line && child.from > node.from) {
        const dist = childCol - col;
        if (dist > 0 && dist < bestDist) {
          best = child;
          bestDist = dist;
        }
      }
    }
  }
  if (best) {
    return state.update({
      selection: { anchor: best.from },
      scrollIntoView: true
    });
  }
  return null;
}

function spatialNavigateUp(state) {
  const cursor = state.field(nodeTreeCursorField, false);
  if (!cursor) return null;
  const node = cursor.getNode?.();
  if (!node) return null;
  const { line, col } = getNodeLineAndColumn(node, state);
  const nodes = getAllNodes(state).filter(n => n !== node);
  let targetLine = -1;
  for (let l = line - 1; l >= 1; l -= 1) {
    if (nodes.some(n => state.doc.lineAt(n.from).number === l)) {
      targetLine = l;
      break;
    }
  }
  if (targetLine === -1) return null;
  let closest = null;
  let minColDiff = Infinity;
  for (const n of nodes) {
    const nLine = state.doc.lineAt(n.from).number;
    if (nLine === targetLine) {
      const nCol = n.from - state.doc.lineAt(n.from).from;
      const colDiff = Math.abs(nCol - col);
      if (colDiff < minColDiff) {
        minColDiff = colDiff;
        closest = n;
      }
    }
  }
  if (closest) {
    return state.update({
      selection: { anchor: closest.from },
      scrollIntoView: true
    });
  }
  return null;
}

function spatialNavigateDown(state) {
  const cursor = state.field(nodeTreeCursorField, false);
  if (!cursor) return null;
  const node = cursor.getNode?.();
  if (!node) return null;
  const { line, col } = getNodeLineAndColumn(node, state);
  const nodes = getAllNodes(state).filter(n => n !== node);
  const maxLine = state.doc.lines;
  let targetLine = -1;
  for (let l = line + 1; l <= maxLine; l += 1) {
    if (nodes.some(n => state.doc.lineAt(n.from).number === l)) {
      targetLine = l;
      break;
    }
  }
  if (targetLine === -1) return null;
  let closest = null;
  let minColDiff = Infinity;
  for (const n of nodes) {
    const nLine = state.doc.lineAt(n.from).number;
    if (nLine === targetLine) {
      const nCol = n.from - state.doc.lineAt(n.from).from;
      const colDiff = Math.abs(nCol - col);
      if (colDiff < minColDiff) {
        minColDiff = colDiff;
        closest = n;
      }
    }
  }
  if (closest) {
    return state.update({
      selection: { anchor: closest.from },
      scrollIntoView: true
    });
  }
  return null;
}

class GamepadController {
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
  } = {}) {
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
      navigationMode: "structural",
      buttonRepeat: {},
      prevSnapshot: cloneGamepadSnapshot(createEmptyGamepadState({ now: this.now }))
    };

    this.intervalId = null;
    this.started = false;
    this.pointerListener = () => this.showEditorCursor();
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (this.view?.dom) {
      this.view.dom.addEventListener("pointerdown", this.pointerListener);
    }
    this.gamepadManager.connect();
    this.intervalId = this.scheduler.set(() => this.tick(), this.pollInterval);
    this.tick();
  }

  stop() {
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

  dispose() {
    this.stop();
    this.gamepadManager.reset();
  }

  getState() {
    return {
      ...this.state,
      buttonRepeat: { ...this.state.buttonRepeat },
      prevSnapshot: cloneGamepadSnapshot(this.state.prevSnapshot)
    };
  }

  tick() {
    const snapshot = this.gamepadManager.poll();
    this.processSnapshot(snapshot);
  }

  processSnapshot(snapshot) {
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
      this.handleButtonCommands(snapshot, prevSnapshot);
    }

    this.state.prevSnapshot = cloneGamepadSnapshot(snapshot);
  }

  handleNavigation(snapshot, prevSnapshot) {
    if (!this.view) return;
    const now = this.now();
    const navigationMap = this.state.navigationMode === "spatial"
      ? {
          Up: spatialNavigateUp,
          Down: spatialNavigateDown,
          Left: spatialNavigateLeft,
          Right: spatialNavigateRight
        }
      : {
          Up: navigatePrev,
          Down: navigateNext,
          Left: navigatePrev,
          Right: navigateNext
        };

    for (const [button, handler] of Object.entries(navigationMap)) {
      this.applyNavigation(button, handler, snapshot, now);
    }

    if (isNewPress("A", snapshot, prevSnapshot)) {
      this.dispatchTransaction(navigateIn(this.view.state));
    }
    if (isNewPress("B", snapshot, prevSnapshot)) {
      this.dispatchTransaction(navigateOut(this.view.state));
    }
  }

  applyNavigation(button, handler, snapshot, now) {
    if (!isButtonPressed(button, snapshot)) {
      if (this.state.buttonRepeat[button]) {
        delete this.state.buttonRepeat[button];
      }
      return;
    }

    const repeat = computeRepeatState(this.state.buttonRepeat[button], now, this.repeatConfig);
    this.state.buttonRepeat[button] = repeat.state;
    if (!repeat.shouldTrigger) return;

    const transaction = handler(this.view.state);
    if (transaction) {
      this.dispatchTransaction(transaction);
    }
  }

  handlePickerNavigation(snapshot, prevSnapshot) {
    if (this.state.mode !== "picker" && this.state.mode !== "number-picker") return;
    const direction = resolvePickerDirection(snapshot, prevSnapshot);
    const sticks = resolveStickVectors(snapshot);
    if (direction) {
      dispatchPickerEvent(this.eventTarget, { direction, ...sticks }, this.logger);
    } else {
      // Forward stick position for radial menus even without D-pad movement
      dispatchPickerEvent(this.eventTarget, { ...sticks }, this.logger);
    }

    if (isNewPress("A", snapshot, prevSnapshot)) {
      dispatchPickerEvent(this.eventTarget, { action: "select" }, this.logger);
    } else if (isNewPress("B", snapshot, prevSnapshot) || isNewPress("Back", snapshot, prevSnapshot)) {
      dispatchPickerEvent(this.eventTarget, { action: "cancel" }, this.logger);
      this.cancelAction();
    }
  }

  handleNumberAdjustment(snapshot, prevSnapshot) {
    if (!this.view) return;
    if (isNewPress("LB", snapshot, prevSnapshot)) {
      const adjusted = adjustNumberAtCursor(this.view, -1);
      if (adjusted) this.hideEditorCursor();
    } else if (isNewPress("RB", snapshot, prevSnapshot)) {
      const adjusted = adjustNumberAtCursor(this.view, 1);
      if (adjusted) this.hideEditorCursor();
    }
  }

  handleButtonCommands(snapshot, prevSnapshot) {
    const pressed = pressedButtons(snapshot);
    if (pressed.length === 0) return;

    for (const command of COMMAND_REGISTRY) {
      if (command.mode && command.mode !== this.state.mode) continue;
      if (!this.isComboTriggered(command.combo, snapshot, prevSnapshot)) continue;
      command.action(this);
    }
  }

  isComboTriggered(combo, snapshot, prevSnapshot) {
    return combo.every(button => isButtonPressed(button, snapshot)) &&
      combo.some(button => isNewPress(button, snapshot, prevSnapshot));
  }

  dispatchTransaction(transaction) {
    if (!this.view || !transaction) return;
    this.view.dispatch(transaction);
    this.hideEditorCursor();
  }

  showEditorCursor() {
    if (this.view?.dom) {
      this.view.dom.classList.remove("hide-cursor");
    }
  }

  hideEditorCursor() {
    if (this.view?.dom) {
      this.view.dom.classList.add("hide-cursor");
    }
  }

  async openCreateMenu(direction) {
    if (this.state.mode === "picker") {
      this.logger.debug?.("[gamepadControl] Picker already open; ignoring create menu request");
      return;
    }

    const categories = await buildHierarchicalMenuModel();

    this.state.mode = "picker";
    this.state.picker = {
      direction,
      closeMenu: null
    };

    const style = activeUserSettings?.ui?.gamepadPickerStyle || 'grid';
    const closeMenu = (style === 'radial')
      ? showRadialPickerMenu({
          categories,
          title: 'Create',
          onSelect: (entry) => this.handleCreateSelection(entry, direction)
        })
      : showHierarchicalGridPicker({
          categories,
          title: 'Create',
          onSelect: (entry) => this.handleCreateSelection(entry, direction)
        });

    this.state.picker = {
      direction,
      closeMenu
    };
  }

  handleCreateSelection(entry, direction) {
    if (this.onPickerSelect) {
      this.onPickerSelect(entry, 0, direction);
      this.state.mode = "normal";
      this.state.picker = null;
      return;
    }
    const text = (entry && entry.insertText) ? entry.insertText : String(entry?.value ?? '');
    if (!text) {
      this.state.mode = "normal"; this.state.picker = null; return;
    }
    const view = this.view;
    if (!view) { this.state.mode = "normal"; this.state.picker = null; return; }
    const node = getCursorNode(view);
    const range = node ? getTrimmedRange(node, view.state) : view.state.selection.main;
    const from = typeof range?.from === 'number' ? range.from : view.state.selection.main.from;
    const to = typeof range?.to === 'number' ? range.to : view.state.selection.main.to;
    view.dispatch({
      changes: { from, to, insert: text },
      selection: { anchor: from + text.length },
      scrollIntoView: true,
      userEvent: 'insert.picker'
    });
    this.state.mode = "normal";
    this.state.picker = null;
    this.hideEditorCursor();
  }

  openNumberPicker(direction) {
    this.state.mode = "number-picker";
    const closeMenu = this.pickerUI.showNumberMenu({
      title: "Pick a Number",
      initialValue: 0,
      min: -9999,
      max: 9999,
      step: 1,
      onSelect: value => {
        this.state.mode = "normal";
        this.state.numberPicker = null;
        if (this.onPickerSelect) {
          this.onPickerSelect({ label: String(value), value }, 0, direction);
        }
      }
    });

    this.state.numberPicker = {
      direction,
      closeMenu
    };
  }

  cancelAction() {
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

  deleteNode() {
    const removed = deleteNodeAtCursor(this.view);
    if (!removed) return;
    this.hideEditorCursor();
  }

  runEvalNow() {
    if (!this.view) return;
    evalNow({ state: this.view.state, view: this.view });
  }

  toggleNavigationMode() {
    this.state.navigationMode = this.state.navigationMode === "structural" ? "spatial" : "structural";
    this.logger.debug?.(`[gamepadControl] navigationMode set to ${this.state.navigationMode}`);
  }
}

export function createGamepadController(options = {}) {
  return new GamepadController(options);
}

export function initGamepadControl(view, options = {}) {
  const controller = createGamepadController({ view, ...options });
  controller.start();
  return controller;
}
