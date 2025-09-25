/**
 * Gamepad Support Module
 *
 * Provides an interface for polling and managing browser Gamepad API input.
 * The core manager exposes pure data snapshots while all side effects
 * (DOM listeners, logging, scheduling) are injected for easier testing.
 */

const DEFAULT_AXIS_DEADZONE = 0.1;
const DEFAULT_BUTTON_THRESHOLD = 0.1;

export const BUTTON_MAP = {
  0: 'A',
  1: 'B',
  2: 'X',
  3: 'Y',
  4: 'LB',
  5: 'RB',
  6: 'LT',
  7: 'RT',
  8: 'Back',
  9: 'Start',
  10: 'LeftStickPress',
  11: 'RightStickPress',
  12: 'Up',
  13: 'Down',
  14: 'Left',
  15: 'Right'
};

export const AXIS_MAP = {
  0: 'LeftStickX',
  1: 'LeftStickY',
  2: 'RightStickX',
  3: 'RightStickY'
};

const EVENT_TYPES = /** @type {const} */ (['connected', 'disconnected', 'primaryChanged']);

const noop = () => {};
const nullLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop
};

const defaultGetGamepads = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    return navigator.getGamepads();
  }
  return [];
};

const defaultAddListener = (type, handler) => {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(type, handler);
  }
};

const defaultRemoveListener = (type, handler) => {
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener(type, handler);
  }
};

const defaultNow = () => Date.now();

const toArray = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Array.prototype.slice.call(value);
};

const uniqueNamesFromMap = mapping => {
  const names = new Set();
  Object.values(mapping).forEach(name => names.add(name));
  return Array.from(names);
};

function createEmptySnapshot({ now, buttonNames, axisNames }) {
  const timestamp = now();
  const buttons = {};
  buttonNames.forEach(name => {
    buttons[name] = {
      pressed: false,
      value: 0
    };
  });

  const axes = {};
  axisNames.forEach(name => {
    axes[name] = 0;
  });

  return {
    connected: false,
    id: '',
    index: null,
    timestamp,
    buttons,
    axes
  };
}

function cloneSnapshot(snapshot) {
  if (!snapshot) return null;
  return {
    connected: Boolean(snapshot.connected),
    id: snapshot.id || '',
    index: typeof snapshot.index === 'number' ? snapshot.index : null,
    timestamp: snapshot.timestamp ?? 0,
    buttons: Object.fromEntries(
      Object.entries(snapshot.buttons || {}).map(([name, value]) => [
        name,
        {
          pressed: Boolean(value?.pressed),
          value: typeof value?.value === 'number' ? value.value : 0
        }
      ])
    ),
    axes: Object.fromEntries(
      Object.entries(snapshot.axes || {}).map(([name, value]) => [
        name,
        typeof value === 'number' ? value : 0
      ])
    )
  };
}

function normaliseGamepadSnapshot(gamepad, {
  now,
  buttonMap,
  axisMap,
  buttonNames,
  axisNames,
  deadzone,
  threshold
}) {
  const timestamp = now();
  const buttons = {};
  buttonNames.forEach(name => {
    buttons[name] = {
      pressed: false,
      value: 0
    };
  });

  const axes = {};
  axisNames.forEach(name => {
    axes[name] = 0;
  });

  const rawButtons = gamepad?.buttons || [];
  for (let index = 0; index < rawButtons.length; index += 1) {
    const button = rawButtons[index];
    if (!button) continue;
    const name = buttonMap[index] || `Button${index}`;
    buttons[name] = {
      pressed: Number(button.value || 0) >= threshold,
      value: Number(button.value || 0)
    };
  }

  const rawAxes = gamepad?.axes || [];
  for (let index = 0; index < rawAxes.length; index += 1) {
    const name = axisMap[index] || `Axis${index}`;
    const value = typeof rawAxes[index] === 'number' ? rawAxes[index] : 0;
    axes[name] = Math.abs(value) < deadzone ? 0 : value;
  }

  return {
    connected: Boolean(gamepad?.connected),
    id: gamepad?.id || '',
    index: typeof gamepad?.index === 'number' ? gamepad.index : null,
    timestamp,
    buttons,
    axes
  };
}

function extractGamepad(event) {
  if (!event) return null;
  if (event.gamepad) return event.gamepad;
  if (event.detail && event.detail.gamepad) return event.detail.gamepad;
  return null;
}

function createListenerRegistry() {
  return EVENT_TYPES.reduce((registry, type) => {
    registry[type] = new Set();
    return registry;
  }, {});
}

export class GamepadManager {
  constructor({
    getGamepads = defaultGetGamepads,
    addListener = defaultAddListener,
    removeListener = defaultRemoveListener,
    now = defaultNow,
    logger = nullLogger,
    buttonMap = BUTTON_MAP,
    axisMap = AXIS_MAP,
    deadzone = DEFAULT_AXIS_DEADZONE,
    threshold = DEFAULT_BUTTON_THRESHOLD,
    supported = typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function'
  } = {}) {
    this.getGamepads = getGamepads;
    this.addListener = addListener;
    this.removeListener = removeListener;
    this.now = now;
    this.logger = logger ?? nullLogger;
    this.buttonMap = { ...buttonMap };
    this.axisMap = { ...axisMap };
    this.deadzone = deadzone;
    this.threshold = threshold;
    this.supported = Boolean(supported);

    this.buttonNames = uniqueNamesFromMap(this.buttonMap);
    this.axisNames = uniqueNamesFromMap(this.axisMap);

    this.eventListeners = createListenerRegistry();

    this.primaryIndex = null;
    this.lastSnapshot = createEmptySnapshot({
      now: this.now,
      buttonNames: this.buttonNames,
      axisNames: this.axisNames
    });

    this.connected = false;
    this.boundConnectedListener = null;
    this.boundDisconnectedListener = null;
  }

  isSupported() {
    return this.supported;
  }

  connect() {
    if (!this.supported || this.connected) {
      return this.supported;
    }

    if (typeof this.addListener === 'function') {
      this.boundConnectedListener = event => {
        const gamepad = extractGamepad(event);
        if (gamepad) {
          this.handleGamepadConnected(gamepad);
        }
      };
      this.boundDisconnectedListener = event => {
        const gamepad = extractGamepad(event);
        if (gamepad) {
          this.handleGamepadDisconnected(gamepad);
        }
      };
      this.addListener('gamepadconnected', this.boundConnectedListener);
      this.addListener('gamepaddisconnected', this.boundDisconnectedListener);
    }

    this.connected = true;
    this.refreshPrimaryFromGamepads();
    return true;
  }

  disconnect() {
    if (!this.connected) return;
    if (typeof this.removeListener === 'function') {
      if (this.boundConnectedListener) {
        this.removeListener('gamepadconnected', this.boundConnectedListener);
        this.boundConnectedListener = null;
      }
      if (this.boundDisconnectedListener) {
        this.removeListener('gamepaddisconnected', this.boundDisconnectedListener);
        this.boundDisconnectedListener = null;
      }
    }
    this.connected = false;
  }

  reset() {
    this.primaryIndex = null;
    this.lastSnapshot = createEmptySnapshot({
      now: this.now,
      buttonNames: this.buttonNames,
      axisNames: this.axisNames
    });
  }

  on(event, handler) {
    if (!EVENT_TYPES.includes(event) || typeof handler !== 'function') {
      return noop;
    }
    this.eventListeners[event].add(handler);
    return () => this.eventListeners[event].delete(handler);
  }

  off(event, handler) {
    if (EVENT_TYPES.includes(event) && handler) {
      this.eventListeners[event].delete(handler);
    }
  }

  emit(event, payload) {
    if (!EVENT_TYPES.includes(event)) return;
    this.eventListeners[event].forEach(listener => {
      try {
        listener(payload);
      } catch (error) {
        this.logger.warn?.('Error in gamepad listener', error);
      }
    });
  }

  getPrimaryIndex() {
    return this.primaryIndex;
  }

  getLastSnapshot() {
    return cloneSnapshot(this.lastSnapshot);
  }

  poll(handler) {
    const snapshot = this.computeSnapshot();
    if (handler) {
      handler(cloneSnapshot(snapshot));
    }
    return cloneSnapshot(snapshot);
  }

  handleGamepadConnected(gamepad) {
    this.emit('connected', {
      index: gamepad.index,
      id: gamepad.id || ''
    });
    if (this.primaryIndex === null) {
      this.updatePrimary(gamepad.index, gamepad);
    }
  }

  handleGamepadDisconnected(gamepad) {
    this.emit('disconnected', {
      index: gamepad.index,
      id: gamepad.id || ''
    });
    if (this.primaryIndex === gamepad.index) {
      this.primaryIndex = null;
      this.emit('primaryChanged', {
        index: null,
        previousIndex: gamepad.index,
        id: gamepad.id || ''
      });
      this.refreshPrimaryFromGamepads();
    }
  }

  refreshPrimaryFromGamepads() {
    const pads = this.safeGetGamepads();
    if (this.primaryIndex !== null && pads[this.primaryIndex]) {
      return;
    }
    const nextIndex = this.findNextConnectedIndex(pads, null);
    if (typeof nextIndex === 'number') {
      this.updatePrimary(nextIndex, pads[nextIndex]);
    }
  }

  safeGetGamepads() {
    try {
      return toArray(this.getGamepads());
    } catch (error) {
      this.logger.warn?.('Failed to read gamepads', error);
      return [];
    }
  }

  findNextConnectedIndex(pads, skipIndex) {
    for (let index = 0; index < pads.length; index += 1) {
      if (index === skipIndex) continue;
      if (pads[index]) {
        return index;
      }
    }
    return null;
  }

  updatePrimary(index, gamepad) {
    if (typeof index !== 'number' || this.primaryIndex === index) return;
    const previousIndex = this.primaryIndex;
    this.primaryIndex = index;
    this.emit('primaryChanged', {
      index,
      previousIndex,
      id: gamepad?.id || ''
    });
  }

  computeSnapshot() {
    const pads = this.safeGetGamepads();

    if (this.primaryIndex === null) {
      const nextIndex = this.findNextConnectedIndex(pads, null);
      if (typeof nextIndex === 'number') {
        this.updatePrimary(nextIndex, pads[nextIndex]);
      }
    }

    const gamepad = typeof this.primaryIndex === 'number' ? pads[this.primaryIndex] : null;

    if (!gamepad) {
      this.lastSnapshot = createEmptySnapshot({
        now: this.now,
        buttonNames: this.buttonNames,
        axisNames: this.axisNames
      });
      return this.lastSnapshot;
    }

    this.lastSnapshot = normaliseGamepadSnapshot(gamepad, {
      now: this.now,
      buttonMap: this.buttonMap,
      axisMap: this.axisMap,
      buttonNames: this.buttonNames,
      axisNames: this.axisNames,
      deadzone: this.deadzone,
      threshold: this.threshold
    });
    this.lastSnapshot.connected = true;
    return this.lastSnapshot;
  }
}

export function createEmptyGamepadState({
  now = defaultNow,
  buttonMap = BUTTON_MAP,
  axisMap = AXIS_MAP
} = {}) {
  return createEmptySnapshot({
    now,
    buttonNames: uniqueNamesFromMap(buttonMap),
    axisNames: uniqueNamesFromMap(axisMap)
  });
}

export function createGamepadManager(options = {}) {
  return new GamepadManager(options);
}

let defaultManager = null;

function ensureDefaultManager() {
  if (!defaultManager) {
    defaultManager = createGamepadManager();
  }
  return defaultManager;
}

export function initGamepad() {
  const manager = ensureDefaultManager();
  return manager.connect();
}

export function pollGamepad(handler = null) {
  const manager = ensureDefaultManager();
  return manager.poll(handler);
}

export function isGamepadConnected() {
  const manager = ensureDefaultManager();
  const snapshot = manager.getLastSnapshot();
  return Boolean(snapshot?.connected);
}

export function getPrimaryGamepadIndex() {
  const manager = ensureDefaultManager();
  return manager.getPrimaryIndex();
}

export function resetDefaultGamepadManager() {
  if (defaultManager) {
    defaultManager.disconnect();
    defaultManager.reset();
    defaultManager = null;
  }
}
