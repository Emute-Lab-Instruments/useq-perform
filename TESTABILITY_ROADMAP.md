# Testability & Quality Improvement Roadmap

This document contains a serialized, priority-sorted list of atomic tasks to improve the codebase's testability, maintainability, and correctness. Each task is designed to be:
- **Atomic**: Can be completed independently
- **Non-breaking**: Leaves the codebase in a working state
- **Specific**: Contains enough detail for execution without additional context
- **Testable**: Results can be verified

## Task Tracking
- [ ] = Not started
- [🔄] = In progress
- [✅] = Completed

---

## 🔴 CRITICAL: Security & Stability Fixes (Week 1, Days 1-2)

### 1. [ ] Fix XSS Vulnerability in Serial Communications
**File**: `src/io/serialComms.mjs:73`
**Current Code**: 
```javascript
post('uSEQ is already connected - would you like to <span style="color: red; font-weight: bold; cursor: pointer;" onclick="disconnect()">disconnect</span>?');
```
**Action**: 
1. Remove inline `onclick` handler
2. Create a proper event listener using addEventListener
3. Use text content instead of HTML where possible
**Expected Result**: No inline event handlers in HTML strings

### 2. [ ] Fix Race Condition in Serial Reader
**File**: `src/io/serialComms.mjs:513-525`
**Issue**: `readingActive` flag modified without synchronization
**Action**:
1. Add a mutex/lock pattern using a Promise queue
2. Ensure `readingActive` is only modified in synchronized blocks
3. Add try-finally blocks to ensure flag is reset on errors
**Test**: Verify multiple rapid connect/disconnect calls don't cause errors

### 3. [ ] Add Null Check for Web Serial Support
**File**: `src/main.mjs:14-16`
**Issue**: Application continues without proper initialization if Web Serial unsupported
**Action**:
1. After the early return, show a proper error message to user
2. Initialize UI in a degraded mode (read-only, no serial features)
3. Add a fallback UI state for unsupported browsers
**Test**: Load app in browser without Web Serial API support

### 4. [ ] Fix Error Swallowing in Serial Communications
**File**: `src/io/serialComms.mjs:593-596`
**Action**:
1. Replace console.log with proper error propagation
2. Add error recovery mechanism
3. Notify UI of connection state changes on errors
**Expected**: Errors bubble up to UI layer for user notification

---

## 🟡 PHASE 1: Testing Infrastructure Setup (Week 1, Days 3-5)

### 5. [ ] Install and Configure Vitest
**Action**:
1. Run: `npm install --save-dev vitest @vitest/ui jsdom @testing-library/solid`
2. Create `vitest.config.ts` in root:
```typescript
import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';

export default defineConfig({
  plugins: [solid()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './test/setup.ts',
    coverage: {
      reporter: ['text', 'html', 'lcov'],
      exclude: ['node_modules/', 'test/', '*.config.*'],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80
      }
    }
  }
});
```
3. Add npm scripts to package.json:
```json
"test:unit": "vitest",
"test:coverage": "vitest run --coverage"
```

### 6. [ ] Create Test Setup File
**File**: Create `test/setup.ts`
**Content**:
```typescript
import '@testing-library/jest-dom';

// Mock Web Serial API
global.navigator.serial = {
  getPorts: vi.fn(),
  requestPort: vi.fn(),
  addEventListener: vi.fn()
};

// Mock localStorage
const localStorageMock = {
  getItem: vi.fn(),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn()
};
global.localStorage = localStorageMock;
```

### 7. [ ] Add GitHub Actions CI Pipeline
**File**: Create `.github/workflows/ci.yml`
**Content**:
```yaml
name: CI
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: npm run build
      - run: npm run test:coverage
      - uses: codecov/codecov-action@v3
```

### 8. [ ] Convert Existing Mocha Tests to Vitest
**Files**: `test/circularBuffer.test.mjs`
**Action**:
1. Rename to `test/circularBuffer.test.ts`
2. Replace `import { strict as assert } from 'assert'` with `import { expect } from 'vitest'`
3. Replace `assert.equal()` with `expect().toBe()`
4. Replace `assert.deepEqual()` with `expect().toEqual()`
**Verify**: Run `npm run test:unit` and ensure tests pass

---

## 🟢 PHASE 2: Extract and Test Utilities (Week 2, Days 1-3)

### 9. [ ] Extract DOM Utilities from jQuery Dependencies
**File**: Create `src/utils/dom.mjs`
**Action**:
1. Create pure functions for common DOM operations:
```javascript
export function hideElement(selector) {
  const el = document.querySelector(selector);
  if (el) el.style.display = 'none';
}

export function showElement(selector) {
  const el = document.querySelector(selector);
  if (el) el.style.display = '';
}

export function toggleElement(selector, show) {
  show ? showElement(selector) : hideElement(selector);
}

export function setElementText(selector, text) {
  const el = document.querySelector(selector);
  if (el) el.textContent = text;
}
```
2. Create corresponding test file `test/utils/dom.test.ts`

### 10. [ ] Replace First jQuery Usage with DOM Utilities
**File**: `src/ui/ui.mjs:79`
**Current**: `$("#panel-vis").hide();`
**Action**:
1. Import `import { hideElement } from '../utils/dom.mjs';`
2. Replace with: `hideElement("#panel-vis");`
3. Test manually that panel hiding still works
**Pattern**: Document this pattern for other jQuery replacements

### 11. [ ] Extract Serial State Management
**File**: Create `src/state/serialState.mjs`
**Action**:
1. Move global variables from `serialComms.mjs`:
```javascript
// Instead of global vars, use a state object
export const serialState = {
  port: null,
  reader: null,
  writer: null,
  isReading: false,
  captureMode: false,
  captureCallback: null
};

export function getSerialState() {
  return { ...serialState };
}

export function updateSerialState(updates) {
  Object.assign(serialState, updates);
}
```
2. Create test file `test/state/serialState.test.ts`

### 12. [ ] Create Settings Manager Module
**File**: Create `src/utils/settingsManager.mjs`
**Action**:
1. Extract localStorage operations into testable functions:
```javascript
const STORAGE_KEY = 'useq-settings';

export function loadSettings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch (e) {
    console.error('Failed to load settings:', e);
    return {};
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    return true;
  } catch (e) {
    console.error('Failed to save settings:', e);
    return false;
  }
}

export function clearSettings() {
  localStorage.removeItem(STORAGE_KEY);
}
```
2. Create comprehensive tests with mocked localStorage

---

## 🔵 PHASE 3: Component Testing Foundation (Week 2, Days 4-5)

### 13. [ ] Create First SolidJS Component Test
**File**: Create `test/ui/TestComponent.test.tsx`
**Action**:
```typescript
import { render, fireEvent } from '@testing-library/solid';
import { TestComponent } from '../../src-solid/ui/TestComponent';

describe('TestComponent', () => {
  it('increments counter on click', async () => {
    const { getByText, getByRole } = render(() => <TestComponent />);
    const button = getByRole('button', { name: '+' });
    fireEvent.click(button);
    expect(getByText(/count: 1/i)).toBeDefined();
  });
});
```

### 14. [ ] Add Test for XState Machine
**File**: Create `test/machines/test.machine.test.ts`
**Action**:
```typescript
import { createActor } from 'xstate';
import { testMachine } from '../../src-solid/machines/test.machine';

describe('testMachine', () => {
  it('transitions from idle to loading on LOAD', () => {
    const actor = createActor(testMachine);
    actor.start();
    actor.send({ type: 'LOAD' });
    expect(actor.getSnapshot().value).toBe('loading');
  });
});
```

### 15. [ ] Test Effect Module
**File**: Create `test/effects/test.test.ts`
**Action**:
```typescript
import { Effect } from 'effect';
import { testEffect } from '../../src-solid/effects/test';

describe('testEffect', () => {
  it('returns success after delay', async () => {
    const result = await Effect.runPromise(testEffect);
    expect(result).toBe('Effect completed successfully!');
  });
});
```

---

## 🟣 PHASE 4: Refactor High-Traffic jQuery Components (Week 3)

### 16. [ ] Create Toolbar State Machine
**File**: Create `src-solid/machines/toolbar.machine.ts`
**Action**:
1. Define XState machine for toolbar state:
```typescript
import { createMachine } from 'xstate';

export const toolbarMachine = createMachine({
  id: 'toolbar',
  initial: 'idle',
  context: {
    panels: [],
    activeTool: null,
    isLocked: false
  },
  states: {
    idle: {
      on: {
        SELECT_TOOL: {
          target: 'active',
          actions: 'setActiveTool'
        }
      }
    },
    active: {
      on: {
        DESELECT_TOOL: 'idle',
        LOCK_TOOLBAR: 'locked'
      }
    },
    locked: {
      on: {
        UNLOCK_TOOLBAR: 'active'
      }
    }
  }
});
```
2. Create test file with state transition tests

### 17. [ ] Extract Toolbar HTML Generation
**File**: `src/ui/toolbar.mjs`
**Action**:
1. Replace jQuery HTML string building with template function:
```javascript
export function createToolbarButton(config) {
  const button = document.createElement('div');
  button.className = 'toolbar-button';
  button.dataset.tool = config.tool;
  button.title = config.title;
  
  const icon = document.createElement('i');
  icon.className = 'icon';
  icon.dataset.lucide = config.icon;
  button.appendChild(icon);
  
  return button;
}
```
2. Add unit tests for HTML generation

### 18. [ ] Replace Toolbar jQuery Event Handlers
**File**: `src/ui/toolbar.mjs` (22 jQuery references)
**Action**:
1. Replace each `$(element).click()` with `element.addEventListener('click')`
2. Replace each `$(element).on()` with proper event listeners
3. Create cleanup function to remove listeners
4. Track all listeners in an array for cleanup
**Test**: Verify all toolbar interactions still work

### 19. [ ] Create Settings Panel Component
**File**: Create `src-solid/ui/SettingsPanel.tsx`
**Action**:
1. Port settings UI to SolidJS:
```typescript
import { createSignal, For } from 'solid-js';

export function SettingsPanel() {
  const [settings, setSettings] = createSignal({});
  
  return (
    <div class="settings-panel">
      <h2>Settings</h2>
      <form onSubmit={(e) => e.preventDefault()}>
        {/* Port form fields from existing settings */}
      </form>
    </div>
  );
}
```
2. Add comprehensive component tests

### 20. [ ] Create Settings Effect Module
**File**: Create `src-solid/effects/settings.ts`
**Action**:
```typescript
import { Effect } from 'effect';

export const loadSettingsEffect = Effect.tryPromise({
  try: () => fetch('/api/settings').then(r => r.json()),
  catch: (error) => new Error(`Failed to load settings: ${error}`)
});

export const saveSettingsEffect = (settings: any) =>
  Effect.tryPromise({
    try: () => fetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(settings)
    }),
    catch: (error) => new Error(`Failed to save settings: ${error}`)
  });
```

---

## 🟠 PHASE 5: Migration Pattern Implementation (Week 4)

### 21. [ ] Create Migration Helper Utilities
**File**: Create `src/migration/jqueryBridge.mjs`
**Action**:
```javascript
// Bridge to gradually replace jQuery
export function migrateJQueryElement($element) {
  return {
    hide: () => $element[0].style.display = 'none',
    show: () => $element[0].style.display = '',
    text: (content) => $element[0].textContent = content,
    html: (content) => $element[0].innerHTML = content,
    on: (event, handler) => $element[0].addEventListener(event, handler),
    off: (event, handler) => $element[0].removeEventListener(event, handler)
  };
}
```

### 22. [ ] Document jQuery Migration Pattern
**File**: Create `docs/JQUERY_MIGRATION_GUIDE.md`
**Content**:
1. Document step-by-step jQuery replacement process
2. Provide before/after code examples
3. List common patterns and their replacements
4. Include testing strategies for each pattern

### 23. [ ] Create Tab System Component
**File**: Create `src-solid/ui/TabSystem.tsx`
**Action**:
1. Port `src/ui/tabs.mjs` to SolidJS
2. Use signals for active tab state
3. Implement keyboard navigation
4. Add ARIA attributes for accessibility
5. Create comprehensive test suite

### 24. [ ] Replace Help System jQuery
**Files**: `src/ui/help/moduLispReference.mjs` (60 jQuery calls)
**Action**:
1. Create data structure for help content
2. Replace jQuery DOM manipulation with template functions
3. Use event delegation for click handlers
4. Add search/filter functionality without jQuery
**Priority**: This has the most jQuery usage

### 25. [ ] Extract Theme Manager Logic
**File**: `src/editors/themes/themeManager.mjs`
**Action**:
1. Separate theme computation from DOM manipulation
2. Create pure functions for theme operations
3. Add theme validation and error handling
4. Create comprehensive test suite

---

## 🟤 PHASE 6: Serial Communication Testing (Week 5)

### 26. [ ] Create Web Serial API Mock
**File**: Create `test/mocks/webSerial.ts`
**Action**:
```typescript
export class MockSerialPort {
  readable = new ReadableStream();
  writable = new WritableStream();
  
  async open(options: any) { return Promise.resolve(); }
  async close() { return Promise.resolve(); }
  getInfo() { return { usbVendorId: 0x1234 }; }
}

export function createSerialMock() {
  return {
    requestPort: vi.fn(() => Promise.resolve(new MockSerialPort())),
    getPorts: vi.fn(() => Promise.resolve([]))
  };
}
```

### 27. [ ] Add Serial Communication Tests
**File**: Create `test/io/serialComms.test.ts`
**Action**:
1. Test connection establishment
2. Test data reading/writing
3. Test error handling
4. Test reconnection logic
5. Test capture mode functionality

### 28. [ ] Create Serial State Machine
**File**: Create `src-solid/machines/serial.machine.ts`
**Action**:
1. Model all serial connection states
2. Handle connection/disconnection events
3. Manage read/write operations
4. Implement retry logic with exponential backoff

### 29. [ ] Add Integration Tests for Serial Flow
**File**: Create `test/integration/serialFlow.test.ts`
**Action**:
1. Test complete connection flow
2. Test data transmission scenarios
3. Test error recovery
4. Test concurrent operations

---

## ⚫ PHASE 7: Code Quality Improvements (Week 6)

### 30. [ ] Add ESLint Configuration
**Action**:
1. Install: `npm install --save-dev eslint @typescript-eslint/eslint-plugin`
2. Create `.eslintrc.json`:
```json
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended"
  ],
  "rules": {
    "no-var": "error",
    "prefer-const": "error",
    "no-unused-vars": "error",
    "no-console": "warn"
  }
}
```
3. Add script: `"lint": "eslint src src-solid --ext .js,.mjs,.ts,.tsx"`

### 31. [ ] Fix All ESLint Errors
**Action**:
1. Run `npm run lint`
2. Fix each error category systematically
3. Use `--fix` for automatic fixes where safe
4. Document manual fixes needed

### 32. [ ] Add Prettier Configuration
**File**: Create `.prettierrc`
**Content**:
```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100
}
```
**Action**: Run prettier on all source files

### 33. [ ] Replace var with let/const
**Files**: All `.mjs` and `.js` files
**Action**:
1. Search for all `var` declarations
2. Replace with `const` where value doesn't change
3. Replace with `let` where reassignment occurs
4. Test each file after changes

### 34. [ ] Add TypeScript to Legacy Code
**Action**:
1. Rename `.mjs` files to `.ts` one at a time
2. Add type annotations gradually
3. Fix type errors
4. Ensure build still works

---

## 🔷 PHASE 8: UI Component Migration (Week 7)

### 35. [ ] Create Panel Manager Component
**File**: Create `src-solid/ui/PanelManager.tsx`
**Action**:
1. Port panel management logic
2. Use context for panel state
3. Implement panel visibility controls
4. Add resize functionality
5. Create tests for all panel operations

### 36. [ ] Migrate Console Component
**File**: Port `src/ui/console.mjs`
**Action**:
1. Create `src-solid/ui/Console.tsx`
2. Implement virtual scrolling for performance
3. Add log level filtering
4. Create clear/export functionality
5. Add comprehensive tests

### 37. [ ] Create Visualization Components
**Files**: Port `src/ui/serialVis/` and `src/ui/internalVis/`
**Action**:
1. Create SolidJS visualization components
2. Use canvas or SVG for rendering
3. Implement real-time updates
4. Add performance optimizations
5. Create visual regression tests

### 38. [ ] Migrate Camera Interface
**File**: Port `src/ui/camera.mjs`
**Action**:
1. Create `src-solid/ui/Camera.tsx`
2. Handle media permissions properly
3. Add error boundaries
4. Implement capture functionality
5. Add tests with mocked media API

---

## 🔶 PHASE 9: Editor Integration (Week 8)

### 39. [ ] Create CodeMirror Wrapper Component
**File**: Create `src-solid/ui/Editor.tsx`
**Action**:
1. Wrap CodeMirror in SolidJS component
2. Handle editor lifecycle properly
3. Implement theme switching
4. Add extension management
5. Create integration tests

### 40. [ ] Port Editor Extensions
**Files**: `src/editors/extensions/`
**Action**:
1. Review each extension for jQuery usage
2. Convert to pure CodeMirror extensions
3. Add tests for each extension
4. Document extension API

### 41. [ ] Migrate Gamepad Control
**File**: Port `src/editors/gamepadControl.mjs`
**Action**:
1. Create `src-solid/effects/gamepad.ts`
2. Use Effect for gamepad polling
3. Create state machine for gamepad state
4. Add input mapping configuration
5. Mock gamepad API for testing

### 42. [ ] Port Keymap Management
**File**: Port `src/editors/keymaps.mjs`
**Action**:
1. Create type-safe keymap definitions
2. Implement keymap switching logic
3. Add customization support
4. Create tests for all keybindings

---

## 🔴 PHASE 10: Core System Migration (Week 9)

### 43. [ ] Create Application State Machine
**File**: Create `src-solid/machines/app.machine.ts`
**Action**:
1. Model entire application state
2. Coordinate sub-machines (serial, toolbar, settings)
3. Handle initialization flow
4. Implement error recovery
5. Add comprehensive state tests

### 44. [ ] Port URL Parameter Handling
**File**: Port `src/urlParams.mjs`
**Action**:
1. Create `src-solid/routing/urlParams.ts`
2. Use SolidJS router for parameter handling
3. Implement parameter validation
4. Add parameter persistence
5. Create tests for all parameter combinations

### 45. [ ] Migrate Main UI Orchestrator
**File**: Port `src/ui/ui.mjs`
**Action**:
1. Create `src-solid/App.tsx` as main component
2. Coordinate all UI components
3. Handle initialization sequence
4. Implement error boundaries
5. Add integration tests

### 46. [ ] Port Main Entry Point
**File**: Port `src/main.mjs`
**Action**:
1. Create `src-solid/index.tsx`
2. Initialize SolidJS app
3. Set up providers and context
4. Handle browser compatibility
5. Add smoke tests

---

## 🟢 PHASE 11: Testing Completion (Week 10)

### 47. [ ] Add E2E Tests with Playwright
**Action**:
1. Install: `npm install --save-dev @playwright/test`
2. Create `e2e/` directory with test scenarios
3. Test critical user flows
4. Add visual regression tests
5. Integrate with CI pipeline

### 48. [ ] Achieve 80% Code Coverage
**Action**:
1. Run coverage report
2. Identify uncovered code paths
3. Add tests for missing coverage
4. Focus on critical business logic
5. Document why certain code is untested

### 49. [ ] Add Performance Tests
**Action**:
1. Create performance benchmarks
2. Test rendering performance
3. Test memory usage
4. Test serial communication throughput
5. Set up performance monitoring

### 50. [ ] Create Test Documentation
**File**: Create `docs/TESTING_GUIDE.md`
**Content**:
1. Document testing strategy
2. Provide test writing guidelines
3. Include examples for each test type
4. Document mocking strategies
5. Add troubleshooting section

---

## 🏁 PHASE 12: Cleanup and Documentation (Week 11)

### 51. [ ] Remove jQuery Dependency
**Action**:
1. Verify no jQuery usage remains
2. Remove jQuery from package.json
3. Remove jQuery script tags
4. Update build configuration
5. Run full test suite

### 52. [ ] Update All Documentation
**Files**: Update README.md, MIGRATION_README.md
**Action**:
1. Document new architecture
2. Update setup instructions
3. Add development guidelines
4. Include troubleshooting guide
5. Add API documentation

### 53. [ ] Add JSDoc Comments
**Action**:
1. Add JSDoc to all exported functions
2. Document complex algorithms
3. Add type information
4. Generate API documentation
5. Set up documentation generation

### 54. [ ] Create Architecture Decision Records
**File**: Create `docs/adr/` directory
**Action**:
1. Document why SolidJS was chosen
2. Document state management decisions
3. Document testing strategy
4. Document migration approach
5. Document future considerations

### 55. [ ] Final Audit and Optimization
**Action**:
1. Run bundle size analysis
2. Optimize imports and code splitting
3. Remove dead code
4. Run security audit
5. Create final audit report

---

## Success Metrics

### Coverage Goals
- **Unit Tests**: 85% coverage
- **Integration Tests**: 70% coverage
- **E2E Tests**: Critical paths covered
- **Total Coverage**: >80%

### Quality Metrics
- **ESLint Errors**: 0
- **TypeScript Errors**: 0
- **Bundle Size**: <500KB
- **Lighthouse Score**: >90

### Migration Progress
- **jQuery Removed**: 100%
- **Components Migrated**: 100%
- **Legacy Code**: 0%
- **Modern Stack**: 100%

---

## Notes for Implementing Agents

### General Guidelines
1. **Always run tests** after making changes
2. **Commit frequently** with descriptive messages
3. **Keep changes atomic** - one task per commit
4. **Update tests** when changing functionality
5. **Document** any deviations from the plan

### Testing Commands
```bash
npm run test:unit        # Run unit tests
npm run test:coverage    # Run with coverage
npm run lint            # Check code quality
npm run build           # Verify build works
npm run dev             # Test in browser
```

### Git Commit Format
```
type(scope): description

- Detailed change 1
- Detailed change 2

Refs: #task-number
```

### When Blocked
If a task cannot be completed:
1. Document the blocker
2. Create a workaround if possible
3. Move to next non-dependent task
4. Update this document with notes

---

*Last Updated: [Current Date]*
*Total Tasks: 55*
*Estimated Duration: 11 weeks*
*Priority: Critical → High → Medium → Low*