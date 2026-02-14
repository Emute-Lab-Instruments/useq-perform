import { JSDOM } from 'jsdom';

var defaultEnvironmentState =
{
  areInBrowser: true,
  areInDesktopApp: false,
  isWebSerialAvailable: false,
  isInDevmode: false,
  userSettings: { name: 'Test User' },
  urlParams: {}
};

// Create a DOM instance for testing
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body><canvas id="serialcanvas" width="800" height="400"></canvas></body></html>', {
  pretendToBeVisual: true,
  resources: "usable"
});

// Set global variables for browser APIs
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLDivElement = dom.window.HTMLDivElement;
global.HTMLCanvasElement = dom.window.HTMLCanvasElement;
global.Element = dom.window.Element;
global.CustomEvent = dom.window.CustomEvent;
global.Range = dom.window.Range;

if (global.Range && global.Range.prototype) {
  if (!global.Range.prototype.getClientRects) {
    global.Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  }
  if (!global.Range.prototype.getBoundingClientRect) {
    global.Range.prototype.getBoundingClientRect = () => ({
      x: 0, y: 0, top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0
    });
  }
}

// Mock matchMedia since jsdom doesn't provide it by default
global.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => { },
  removeListener: () => { },
  addEventListener: () => { },
  removeEventListener: () => { },
  dispatchEvent: () => { },
});

// Mock MutationObserver for CodeMirror
global.MutationObserver = class MutationObserver {
  constructor(callback) {
    this.callback = callback;
  }
  observe() { }
  disconnect() { }
  takeRecords() { return []; }
};

// Mock getComputedStyle for CSS property access
global.getComputedStyle = global.window.getComputedStyle = (element) => ({
  getPropertyValue: (property) => {
    // Mock CSS custom properties for testing
    if (property === '--code-eval-highlight-color-connected') {
      return '#00ff00';
    }
    if (property === '--code-eval-highlight-color-disconnected') {
      return '#ff0000';
    }
    if (property === '--code-eval-highlight-color-preview') {
      return 'rgba(100, 200, 255, 0.7)';
    }
    return '';
  },
  backgroundColor: element.classList.contains('modal') ? 'rgb(45, 45, 45)' : 'rgb(255, 255, 255)',
  color: element.classList.contains('modal') ? 'rgb(240, 240, 240)' : 'rgb(0, 0, 0)',
  display: element.style.display || 'block',
  zIndex: element.style.zIndex || 'auto'
});

// Add basic styling to documentElement for dark theme testing
global.document.documentElement.classList.add('cm-theme-light');

// jQuery has been removed from the project. No mock needed.

// Mock canvas and canvas context
dom.window.HTMLCanvasElement.prototype.getContext = () => ({
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  beginPath: () => {},
  moveTo: () => {},
  lineTo: () => {},
  stroke: () => {},
  fill: () => {},
  clearRect: () => {},
  fillRect: () => {},
  arc: () => {},
  closePath: () => {},
  save: () => {},
  restore: () => {},
  translate: () => {},
  scale: () => {},
  rotate: () => {},
  setTransform: () => {},
  transform: () => {},
  setLineDash: () => {},
  lineDashOffset: 0,
  createLinearGradient: () => ({
    addColorStop: () => {}
  }),
  createRadialGradient: () => ({
    addColorStop: () => {}
  }),
  getImageData: () => ({ data: new Uint8ClampedArray(4) }),
  putImageData: () => {},
  createImageData: () => ({ data: new Uint8ClampedArray(4) }),
  drawImage: () => {},
  measureText: () => ({ width: 0 }),
  fillText: () => {},
  strokeText: () => {}
});

// Mock requestAnimationFrame
global.requestAnimationFrame = (callback) => {
  // Don't actually run the callback to avoid infinite loops in tests
  return 1;
};

global.cancelAnimationFrame = () => {};

// Mock activeUserSettings global
global.activeUserSettings = {
  ui: {
    expressionLastTrackingEnabled: true,
    expressionGutterEnabled: true,
    expressionClearButtonEnabled: true
  }
};

// Mock localStorage for settings persistence
const localStorageMock = {
  getItem: (key) => localStorageMock.store[key] || null,
  setItem: (key, value) => {
    localStorageMock.store[key] = value != null ? value.toString() : '';
  },
  removeItem: (key) => { delete localStorageMock.store[key]; },
  clear: () => { localStorageMock.store = {}; },
  store: {}
};

Object.defineProperty(global.window, 'localStorage', {
  value: localStorageMock,
  writable: true
});

// Mock console methods to avoid noise in test output
console.log = () => { };
console.warn = () => { };
const originalConsoleError = console.error;
console.error = (...args) => {
  // Only show actual errors, not debug logs, and avoid recursion
  if (args[0] && typeof args[0] === 'string' && args[0].includes('Error')) {
    originalConsoleError(...args);
  }
};

export { dom };
