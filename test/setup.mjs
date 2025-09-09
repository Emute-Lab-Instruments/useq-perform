import { JSDOM } from 'jsdom';

// Create a DOM instance for testing
const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', {
  pretendToBeVisual: true,
  resources: "usable"
});

// Set global variables for browser APIs
global.document = dom.window.document;
global.window = dom.window;
global.HTMLElement = dom.window.HTMLElement;
global.HTMLDivElement = dom.window.HTMLDivElement;
global.Element = dom.window.Element;

// Mock matchMedia since jsdom doesn't provide it by default
global.window.matchMedia = (query) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: () => {},
  removeListener: () => {},
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
});

// Mock getComputedStyle for CSS property access
global.window.getComputedStyle = (element) => ({
  getPropertyValue: (property) => {
    // Mock CSS custom properties for testing
    if (property === '--code-eval-highlight-color-connected') {
      return '#00ff00';
    }
    if (property === '--code-eval-highlight-color-disconnected') {
      return '#ff0000';
    }
    return '';
  }
});

// Add basic styling to documentElement for dark theme testing
global.document.documentElement.classList.add('cm-theme-light');

// Mock jQuery for modules that use it
global.$ = (selector) => {
  const mockJQuery = {
    length: 0,
    removeClass: () => mockJQuery,
    addClass: () => mockJQuery,
    text: () => mockJQuery,
    on: () => mockJQuery,
    off: () => mockJQuery,
    prop: () => mockJQuery,
    attr: () => mockJQuery,
    css: () => mockJQuery
  };
  
  // Mock finding elements
  if (selector === '#button-connect') {
    mockJQuery.length = 1;
  }
  
  return mockJQuery;
};

// Mock console methods to avoid noise in test output
console.log = () => {};
console.warn = () => {};
console.error = (...args) => {
  // Only show actual errors, not debug logs
  if (args[0] && args[0].toString().includes('Error')) {
    console.error(...args);
  }
};

export { dom };