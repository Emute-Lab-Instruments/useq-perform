/**
 * Gamepad Support Module
 *
 * Provides an interface for polling and managing browser Gamepad API input.
 * The core manager exposes pure data snapshots while all side effects
 * (DOM listeners, logging, scheduling) are injected for easier testing.
 */

const DEFAULT_AXIS_DEADZONE = 0.1;
const DEFAULT_BUTTON_THRESHOLD = 0.1;

/** Mapping from button index to human-readable name */
export type ButtonMapType = Record<number, string>;
/** Mapping from axis index to human-readable name */
export type AxisMapType = Record<number, string>;

export const BUTTON_MAP: ButtonMapType = {
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

export const AXIS_MAP: AxisMapType = {
  0: 'LeftStickX',
  1: 'LeftStickY',
  2: 'RightStickX',
  3: 'RightStickY'
};

/** Button state in a snapshot */
export interface ButtonState {
  pressed: boolean;
  value: number;
}

/** Gamepad snapshot capturing the state of all buttons and axes */
export interface GamepadSnapshot {
  connected: boolean;
  id: string;
  index: number | null;
  timestamp: number;
  buttons: Record<string, ButtonState>;
  axes: Record<string, number>;
}

/** Event types the GamepadManager can emit */
export type GamepadEventType = 'connected' | 'disconnected' | 'primaryChanged';

/** Payload for connected/disconnected events */
export interface GamepadConnectionPayload {
  index: number;
  id: string;
}

/** Payload for primaryChanged events */
export interface GamepadPrimaryChangedPayload {
  index: number | null;
  previousIndex: number | null;
  id: string;
}

export type GamepadEventPayload = GamepadConnectionPayload | GamepadPrimaryChangedPayload;
export type GamepadEventHandler = (payload: GamepadEventPayload) => void;
export type SnapshotHandler = (snapshot: GamepadSnapshot | null) => void;

/** Logger interface for dependency injection */
export interface GamepadLogger {
  debug: (...args: any[]) => void;
  info: (...args: any[]) => void;
  warn: (...args: any[]) => void;
  error: (...args: any[]) => void;
}

type GetGamepadsFn = () => (Gamepad | null)[] | GamepadList;
type AddListenerFn = (type: string, handler: EventListener) => void;
type RemoveListenerFn = (type: string, handler: EventListener) => void;
type NowFn = () => number;

/** Options for constructing a GamepadManager */
export interface GamepadManagerOptions {
  getGamepads?: GetGamepadsFn;
  addListener?: AddListenerFn;
  removeListener?: RemoveListenerFn;
  now?: NowFn;
  logger?: GamepadLogger;
  buttonMap?: ButtonMapType;
  axisMap?: AxisMapType;
  deadzone?: number;
  threshold?: number;
  supported?: boolean;
}

const EVENT_TYPES: readonly GamepadEventType[] = ['connected', 'disconnected', 'primaryChanged'] as const;

const noop = (): void => {};
const nullLogger: GamepadLogger = {
  debug: noop,
  info: noop,
  warn: noop,
  error: noop
};

const defaultGetGamepads: GetGamepadsFn = () => {
  if (typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function') {
    return navigator.getGamepads();
  }
  return [];
};

const defaultAddListener: AddListenerFn = (type, handler) => {
  if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
    window.addEventListener(type, handler);
  }
};

const defaultRemoveListener: RemoveListenerFn = (type, handler) => {
  if (typeof window !== 'undefined' && typeof window.removeEventListener === 'function') {
    window.removeEventListener(type, handler);
  }
};

const defaultNow: NowFn = () => Date.now();

const toArray = (value: any): any[] => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return Array.prototype.slice.call(value);
};

const uniqueNamesFromMap = (mapping: Record<number, string>): string[] => {
  const names = new Set<string>();
  Object.values(mapping).forEach(name => names.add(name));
  return Array.from(names);
};

interface CreateSnapshotParams {
  now: NowFn;
  buttonNames: string[];
  axisNames: string[];
}

function createEmptySnapshot({ now, buttonNames, axisNames }: CreateSnapshotParams): GamepadSnapshot {
  const timestamp = now();
  const buttons: Record<string, ButtonState> = {};
  buttonNames.forEach(name => {
    buttons[name] = {
      pressed: false,
      value: 0
    };
  });

  const axes: Record<string, number> = {};
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

export function cloneSnapshot(snapshot: GamepadSnapshot | null): GamepadSnapshot | null {
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

interface NormaliseParams {
  now: NowFn;
  buttonMap: ButtonMapType;
  axisMap: AxisMapType;
  buttonNames: string[];
  axisNames: string[];
  deadzone: number;
  threshold: number;
}

function normaliseGamepadSnapshot(gamepad: Gamepad | null, {
  now,
  buttonMap,
  axisMap,
  buttonNames,
  axisNames,
  deadzone,
  threshold
}: NormaliseParams): GamepadSnapshot {
  const timestamp = now();
  const buttons: Record<string, ButtonState> = {};
  buttonNames.forEach(name => {
    buttons[name] = {
      pressed: false,
      value: 0
    };
  });

  const axes: Record<string, number> = {};
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

function extractGamepad(event: any): Gamepad | null {
  if (!event) return null;
  if (event.gamepad) return event.gamepad;
  if (event.detail && event.detail.gamepad) return event.detail.gamepad;
  return null;
}

type ListenerRegistry = Record<GamepadEventType, Set<GamepadEventHandler>>;

function createListenerRegistry(): ListenerRegistry {
  return EVENT_TYPES.reduce((registry, type) => {
    registry[type] = new Set<GamepadEventHandler>();
    return registry;
  }, {} as ListenerRegistry);
}

export class GamepadManager {
  getGamepads: GetGamepadsFn;
  addListener: AddListenerFn;
  removeListener: RemoveListenerFn;
  now: NowFn;
  logger: GamepadLogger;
  buttonMap: ButtonMapType;
  axisMap: AxisMapType;
  deadzone: number;
  threshold: number;
  supported: boolean;

  buttonNames: string[];
  axisNames: string[];
  eventListeners: ListenerRegistry;
  primaryIndex: number | null;
  lastSnapshot: GamepadSnapshot;
  connected: boolean;
  boundConnectedListener: EventListener | null;
  boundDisconnectedListener: EventListener | null;

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
  }: GamepadManagerOptions = {}) {
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

  isSupported(): boolean {
    return this.supported;
  }

  connect(): boolean {
    if (!this.supported || this.connected) {
      return this.supported;
    }

    if (typeof this.addListener === 'function') {
      this.boundConnectedListener = ((event: Event) => {
        const gamepad = extractGamepad(event);
        if (gamepad) {
          this.handleGamepadConnected(gamepad);
        }
      }) as EventListener;
      this.boundDisconnectedListener = ((event: Event) => {
        const gamepad = extractGamepad(event);
        if (gamepad) {
          this.handleGamepadDisconnected(gamepad);
        }
      }) as EventListener;
      this.addListener('gamepadconnected', this.boundConnectedListener);
      this.addListener('gamepaddisconnected', this.boundDisconnectedListener);
    }

    this.connected = true;
    this.refreshPrimaryFromGamepads();
    return true;
  }

  disconnect(): void {
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

  reset(): void {
    this.primaryIndex = null;
    this.lastSnapshot = createEmptySnapshot({
      now: this.now,
      buttonNames: this.buttonNames,
      axisNames: this.axisNames
    });
  }

  on(event: GamepadEventType, handler: GamepadEventHandler): () => void {
    if (!EVENT_TYPES.includes(event) || typeof handler !== 'function') {
      return noop;
    }
    this.eventListeners[event].add(handler);
    return () => this.eventListeners[event].delete(handler);
  }

  off(event: GamepadEventType, handler: GamepadEventHandler): void {
    if (EVENT_TYPES.includes(event) && handler) {
      this.eventListeners[event].delete(handler);
    }
  }

  emit(event: GamepadEventType, payload: GamepadEventPayload): void {
    if (!EVENT_TYPES.includes(event)) return;
    this.eventListeners[event].forEach(listener => {
      try {
        listener(payload);
      } catch (error) {
        this.logger.warn?.('Error in gamepad listener', error);
      }
    });
  }

  getPrimaryIndex(): number | null {
    return this.primaryIndex;
  }

  getLastSnapshot(): GamepadSnapshot | null {
    return cloneSnapshot(this.lastSnapshot);
  }

  poll(handler?: SnapshotHandler | null): GamepadSnapshot | null {
    const snapshot = this.computeSnapshot();
    if (handler) {
      handler(cloneSnapshot(snapshot));
    }
    return cloneSnapshot(snapshot);
  }

  handleGamepadConnected(gamepad: Gamepad): void {
    this.emit('connected', {
      index: gamepad.index,
      id: gamepad.id || ''
    });
    if (this.primaryIndex === null) {
      this.updatePrimary(gamepad.index, gamepad);
    }
  }

  handleGamepadDisconnected(gamepad: Gamepad): void {
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

  refreshPrimaryFromGamepads(): void {
    const pads = this.safeGetGamepads();
    if (this.primaryIndex !== null && pads[this.primaryIndex]) {
      return;
    }
    const nextIndex = this.findNextConnectedIndex(pads, null);
    if (typeof nextIndex === 'number') {
      this.updatePrimary(nextIndex, pads[nextIndex] as Gamepad);
    }
  }

  safeGetGamepads(): (Gamepad | null)[] {
    try {
      return toArray(this.getGamepads());
    } catch (error) {
      this.logger.warn?.('Failed to read gamepads', error);
      return [];
    }
  }

  findNextConnectedIndex(pads: (Gamepad | null)[], skipIndex: number | null): number | null {
    for (let index = 0; index < pads.length; index += 1) {
      if (index === skipIndex) continue;
      if (pads[index]) {
        return index;
      }
    }
    return null;
  }

  updatePrimary(index: number, gamepad: Gamepad | null): void {
    if (typeof index !== 'number' || this.primaryIndex === index) return;
    const previousIndex = this.primaryIndex;
    this.primaryIndex = index;
    this.emit('primaryChanged', {
      index,
      previousIndex,
      id: gamepad?.id || ''
    });
  }

  computeSnapshot(): GamepadSnapshot {
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
}: { now?: NowFn; buttonMap?: ButtonMapType; axisMap?: AxisMapType } = {}): GamepadSnapshot {
  return createEmptySnapshot({
    now,
    buttonNames: uniqueNamesFromMap(buttonMap),
    axisNames: uniqueNamesFromMap(axisMap)
  });
}

export function createGamepadManager(options: GamepadManagerOptions = {}): GamepadManager {
  return new GamepadManager(options);
}

let defaultManager: GamepadManager | null = null;

function ensureDefaultManager(): GamepadManager {
  if (!defaultManager) {
    defaultManager = createGamepadManager();
  }
  return defaultManager;
}

export function initGamepad(): boolean {
  const manager = ensureDefaultManager();
  return manager.connect();
}

export function pollGamepad(handler: SnapshotHandler | null = null): GamepadSnapshot | null {
  const manager = ensureDefaultManager();
  return manager.poll(handler);
}

export function isGamepadConnected(): boolean {
  const manager = ensureDefaultManager();
  const snapshot = manager.getLastSnapshot();
  return Boolean(snapshot?.connected);
}

export function getPrimaryGamepadIndex(): number | null {
  const manager = ensureDefaultManager();
  return manager.getPrimaryIndex();
}

export function resetDefaultGamepadManager(): void {
  if (defaultManager) {
    defaultManager.disconnect();
    defaultManager.reset();
    defaultManager = null;
  }
}
