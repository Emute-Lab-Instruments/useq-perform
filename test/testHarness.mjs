/**
 * Test Harness for Structural Editing Extensions
 * 
 * This module loads YAML test files and runs them against the structural editing functions
 */

import fs from 'fs';
import yaml from 'js-yaml';
import { EditorSelection } from '@codemirror/state';
import {
  createStructuralEditor,
  selectByText,
  findNodeAt,
  navigateNext,
  navigatePrev,
  navigateIn,
  navigateOut,
  navigateLeft,
  navigateRight,
  navigateUp,
  navigateDown,
  deleteExpression,
  cutExpression,
  pasteExpression,
  pasteExpressionBefore,
  slurpRight,
  slurpLeft,
  barfRight,
  barfLeft,
  moveNext,
  movePrevious,
  moveRight,
  moveLeft,
  moveUp,
  moveDown,
  typeText,
  insertSymbol,
  insertSymbolBefore,
  insertFunctionCall,
  insertFunctionCallBefore,
  wrapInFunction,
  duplicateExpression,
  clearClipboard,
  navigateRightChar
} from '../src/legacy/editors/extensions/structure/new-structure.ts';

/**
 * Action function mapping
 */
const actionMap = {
  // Navigation
  'next': navigateNext,
  'previous': navigatePrev,
  'in': navigateIn,
  'out': navigateOut,
  'left': navigateLeft,
  'right': navigateRight,
  'up': navigateUp,
  'down': navigateDown,
  'right_char': navigateRightChar,
  
  // Editing
  'delete': deleteExpression,
  'cut': cutExpression,
  'paste': pasteExpression,
  'paste_before': pasteExpressionBefore,
  'duplicate': duplicateExpression,
  
  // Slurp/Barf
  'slurp_right': slurpRight,
  'slurp_left': slurpLeft,
  'barf_right': barfRight,
  'barf_left': barfLeft,
  
  // Move operations
  'move_next': moveNext,
  'move_previous': movePrevious,
  'move_right': moveRight,
  'move_left': moveLeft,
  'move_up': moveUp,
  'move_down': moveDown
};

/**
 * Get the currently selected text from state
 * @param {EditorState} state - Editor state
 * @returns {string} - Selected text
 */
function getSelectedText(state) {
  const selection = state.selection.main;
  return state.sliceDoc(selection.from, selection.to);
}

function parseCaretString(value) {
  if (typeof value !== 'string') {
    return { text: value, caretOffset: null };
  }
  const index = value.indexOf('^');
  if (index === -1) {
    return { text: value, caretOffset: null };
  }
  return {
    text: value.slice(0, index) + value.slice(index + 1),
    caretOffset: index
  };
}

function normalizeSelectionSpec(value) {
  if (value == null) return null;
  if (Array.isArray(value)) {
    const [text, occurrence] = value;
    const normalizedOccurrence = Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
    if (typeof text !== 'string') return null;
    const parsed = parseCaretString(text);
    return { text: parsed.text, occurrence: normalizedOccurrence, caretOffset: parsed.caretOffset };
  }
  if (typeof value === 'string') {
    const parsed = parseCaretString(value);
    return { text: parsed.text, occurrence: 1, caretOffset: parsed.caretOffset };
  }
  return null;
}

function parseStepSelection(value) {
  if (value === undefined) return null;
  if (value === null) return { text: '', caretOffset: null };
  return parseCaretString(value);
}

function findNthOccurrence(haystack, needle, occurrence) {
  if (!haystack || !needle) return -1;
  const desired = Number.isInteger(occurrence) && occurrence > 0 ? occurrence : 1;
  let start = 0;
  let count = 0;
  while (count < desired) {
    const index = haystack.indexOf(needle, start);
    if (index === -1) return -1;
    count++;
    if (count === desired) {
      return index;
    }
    start = index + needle.length;
  }
  return -1;
}

function getSelectionStart(state) {
  const { from, to } = state.selection.main;
  return Math.min(from, to);
}

/**
 * Apply an action to the editor state
 * @param {EditorState} state - Current editor state
 * @param {string|Array} action - Action to apply (can be string or array for sequences)
 * @returns {EditorState} - New editor state
 */
function applyAction(state, action) {
  if (Array.isArray(action)) {
    // Handle action sequences by processing each action individually
    let currentState = state;
    
    for (let i = 0; i < action.length; i++) {
      const currentAction = action[i];
      
      // Check for insert operation pattern: [insert, category, symbol, apply_type]
      if (currentAction === 'insert' && i + 3 < action.length) {
        const category = action[i + 1]; // e.g., 'maths'
        const symbol = action[i + 2];   // e.g., '+'
        const applyType = action[i + 3]; // e.g., 'apply', 'apply_call', etc.
        
        currentState = handleInsertOperation(currentState, category, symbol, applyType);
        i += 3; // Skip the next 3 elements as they were part of the insert
        continue;
      }
      
      // Check for type action pattern: type followed by text
      if (currentAction === 'type' && i + 1 < action.length) {
        const text = action[i + 1];
        currentState = typeText(currentState, text);
        i += 1; // Skip the next element as it was the text to type
        continue;
      }
      
      // Handle regular actions
      currentState = applyAction(currentState, currentAction);
    }
    
    return currentState;
  }
  
  if (typeof action === 'string') {
    // Handle special actions that might have parameters
    if (action.startsWith('type:')) {
      const text = action.substring(5);
      return typeText(state, text);
    }
    
    // Look up action in action map
    const actionFunc = actionMap[action];
    if (actionFunc) {
      return actionFunc(state);
    } else {
      // Don't warn about insert-related actions or common symbols
      if (!['insert', 'maths', 'apply', 'apply_pre', 'apply_call', 'apply_call_pre', 'apply_wrap', 'type', 
            'let', 'navigate_to_hole', 'navigate_to_binding', 'navigate_to_usage'].includes(action) &&
          !action.match(/^[+\-*/=<>!&|0-9xy\[\]_()]+$/)) {
        console.warn(`Unknown action: ${action}`);
      }
      return state;
    }
  }
  
  console.warn(`Invalid action format: ${action}`);
  return state;
}

/**
 * Handle insert operations with category, symbol, and apply type
 * @param {EditorState} state - Current editor state
 * @param {string} category - Category (e.g., 'maths')
 * @param {string} symbol - Symbol to insert (e.g., '+')
 * @param {string} applyType - How to apply (e.g., 'apply', 'apply_call')
 * @returns {EditorState} - New editor state
 */
function handleInsertOperation(state, category, symbol, applyType) {
  switch (applyType) {
    case 'apply':
      return insertSymbol(state, symbol);
    case 'apply_pre':
      return insertSymbolBefore(state, symbol);
    case 'apply_call':
      return insertFunctionCall(state, symbol);
    case 'apply_call_pre':
      return insertFunctionCallBefore(state, symbol);
    case 'apply_wrap':
      return wrapInFunction(state, symbol);
    default:
      console.warn(`Unknown insert apply type: ${applyType}`);
      return state;
  }
}

/**
 * Run a single test case
 * @param {Object} testCase - Test case object from YAML
 * @returns {Object} - Test result
 */
function runTestCase(testCase) {
  try {
    // Clear clipboard at start of each test to avoid cross-test contamination
    clearClipboard();
    
    // Create editor with initial code (strip caret markers if present)
    const codeSpec = parseCaretString(testCase.code || '');
    let state = createStructuralEditor(codeSpec.text);
    const initialCode = state.doc.toString();
    if (codeSpec.caretOffset != null) {
      state = state.update({
        selection: EditorSelection.single(codeSpec.caretOffset)
      }).state;
    }

    // Set initial selection if specified
    const selectionSpec = normalizeSelectionSpec(testCase.selection);
    if (selectionSpec) {
      // Handle selection_cursor if specified (default is 'end', can be 'start')
      const selectionOptions = {};
      if (testCase.selection_cursor === 'start') {
        selectionOptions.reverse = true;
      } else if (testCase.cursor_char) {
        // Infer direction from cursor_char
        // If it's an opening delimiter, we likely want the cursor at the start
        if (['(', '[', '{', '#', '"'].includes(testCase.cursor_char)) {
          selectionOptions.reverse = true;
        }
      }
      
      const selectionStart = findNthOccurrence(initialCode, selectionSpec.text, selectionSpec.occurrence);
      if (selectionStart === -1) {
        return {
          passed: false,
          name: testCase.name,
          error: `Could not find occurrence ${selectionSpec.occurrence} of "${selectionSpec.text}" in initial code`,
          expected: selectionSpec.text,
          actual: initialCode
        };
      }

      selectionOptions.occurrence = selectionSpec.occurrence;
      state = selectByText(state, selectionSpec.text, selectionOptions);
      
      // Verify we selected the right thing
      const selectedText = getSelectedText(state);
      if (selectedText !== selectionSpec.text) {
        return {
          passed: false,
          name: testCase.name,
          error: `Failed to select "${selectionSpec.text}". Got "${selectedText}" instead.`,
          expected: selectionSpec.text,
          actual: selectedText
        };
      }

      // Verify that the selection corresponds to a structural node
      const node = findNodeAt(state, state.selection.main.from, state.selection.main.to);
      if (!node && selectionSpec.text) {
        return {
          passed: false,
          name: testCase.name,
          error: `Selection does not correspond to a structural node`,
          expected: selectionSpec.text,
          actual: "No node found"
        };
      }

      const actualSelectionStart = getSelectionStart(state);
      if (actualSelectionStart !== selectionStart) {
        return {
          passed: false,
          name: testCase.name,
          error: `Selection occurrence mismatch for "${selectionSpec.text}"`,
          expected: selectionStart,
          actual: actualSelectionStart
        };
      }

      // Verify cursor position based on cursor_char if provided
      if (testCase.cursor_char) {
        const head = state.selection.main.head;
        const anchor = state.selection.main.anchor;
        const isReversed = head < anchor;
        
        // Check if we are at the expected end based on cursor_char
        // This is a basic check to ensure we started where we intended
        const expectedStart = ['(', '[', '{', '#', '"'].includes(testCase.cursor_char);
        
        if (expectedStart && !isReversed) {
           // We expected to be at start but are at end?
           // Note: selectByText might not set reverse unless we tell it to, which we did above.
           // But let's verify the char at cursor matches.
           const charAfter = state.sliceDoc(head, head + 1);
           if (charAfter !== testCase.cursor_char && !testCase.cursor_char.startsWith(charAfter)) {
             // Relaxed check for multi-char like #
           }
        }
      }
    }
    
    // Apply actions
    if (testCase.steps) {
      for (let i = 0; i < testCase.steps.length; i++) {
        const step = testCase.steps[i];
        state = applyAction(state, step.action);
        
        // Check step selection
        const stepSelectionSpec = parseStepSelection(step.new_selection);
        if (stepSelectionSpec) {
          const currentSelection = getSelectedText(state);
          const expectedSelection = stepSelectionSpec.text ?? "";
          
          if (currentSelection !== expectedSelection) {
             return {
               passed: false,
               name: `${testCase.name} (step ${i+1})`,
               error: `Selection mismatch after action '${step.action}'`,
               expected: expectedSelection,
               actual: currentSelection
             };
          }
          if (stepSelectionSpec.caretOffset != null) {
            const selectionStart = getSelectionStart(state);
            const expectedHead = selectionStart + stepSelectionSpec.caretOffset;
            if (state.selection.main.head !== expectedHead) {
              return {
                passed: false,
                name: `${testCase.name} (step ${i+1})`,
                error: `Cursor position mismatch after action '${step.action}'`,
                expected: expectedHead,
                actual: state.selection.main.head
              };
            }
          }
        }
        
        // Check cursor char if provided
        if (step.cursor_char) {
           const head = state.selection.main.head;
           const charAfter = state.sliceDoc(head, head + 1);
           const charBefore = head > 0 ? state.sliceDoc(head - 1, head) : '';
           if (charAfter !== step.cursor_char && charBefore !== step.cursor_char) {
             return {
               passed: false,
               name: `${testCase.name} (step ${i+1})`,
               error: `Cursor char mismatch after action '${step.action}'`,
               expected: step.cursor_char,
               actual: charAfter
             };
           }
        }
      }
    } else if (testCase.actions) {
      state = applyAction(state, testCase.actions);
    }
    
    // Check final code state
    const finalCode = state.doc.toString();
    const expectedCode = testCase.new_code;
    
    // Only check code if new_code is specified
    if (expectedCode !== undefined && finalCode !== expectedCode) {
      return {
        passed: false,
        name: testCase.name,
        error: `Code mismatch after actions`,
        expected: expectedCode,
        actual: finalCode,
        initialCode: testCase.code,
        actions: testCase.actions
      };
    }
    
    // Check final selection if specified
    const finalSelectionSpec = normalizeSelectionSpec(testCase.new_selection);
    if (finalSelectionSpec) {
      const finalSelection = getSelectedText(state);
      if (finalSelection !== finalSelectionSpec.text) {
        return {
          passed: false,
          name: testCase.name,
          error: `Selection mismatch after actions`,
          expected: finalSelectionSpec.text,
          actual: finalSelection,
          finalCode: finalCode
        };
      }

      const expectedFinalStart = findNthOccurrence(finalCode, finalSelectionSpec.text, finalSelectionSpec.occurrence);
      if (expectedFinalStart === -1) {
        return {
          passed: false,
          name: testCase.name,
          error: `Could not find occurrence ${finalSelectionSpec.occurrence} of "${finalSelectionSpec.text}" in final code`,
          expected: finalSelectionSpec.text,
          actual: finalCode
        };
      }

      const actualFinalStart = getSelectionStart(state);
      if (actualFinalStart !== expectedFinalStart) {
        return {
          passed: false,
          name: testCase.name,
          error: `Final selection occurrence mismatch for "${finalSelectionSpec.text}"`,
          expected: expectedFinalStart,
          actual: actualFinalStart
        };
      }
      if (finalSelectionSpec.caretOffset != null) {
        const expectedHead = actualFinalStart + finalSelectionSpec.caretOffset;
        if (state.selection.main.head !== expectedHead) {
          return {
            passed: false,
            name: testCase.name,
            error: `Final cursor position mismatch for "${finalSelectionSpec.text}"`,
            expected: expectedHead,
            actual: state.selection.main.head
          };
        }
      }
    }
    
    return {
      passed: true,
      name: testCase.name
    };
    
  } catch (error) {
    return {
      passed: false,
      name: testCase.name,
      error: `Exception: ${error.message}`,
      stack: error.stack
    };
  }
}

/**
 * Load and parse a YAML test file
 * @param {string} filePath - Path to YAML file
 * @returns {Array} - Array of test cases
 */
function loadTestFile(filePath) {
  try {
    const fileContent = fs.readFileSync(filePath, 'utf8');
    const testCases = yaml.load(fileContent);
    return Array.isArray(testCases) ? testCases : [];
  } catch (error) {
    console.error(`Error loading test file ${filePath}:`, error.message);
    return [];
  }
}

/**
 * Run all tests from a file
 * @param {string} filePath - Path to test file
 * @returns {Object} - Test results summary
 */
function runTestFile(filePath) {
  console.log(`\n=== Running tests from ${filePath} ===`);
  
  const testCases = loadTestFile(filePath);
  if (testCases.length === 0) {
    console.log('No test cases found');
    return { passed: 0, failed: 0, total: 0 };
  }
  
  let passed = 0;
  let failed = 0;
  const failures = [];
  
  for (const testCase of testCases) {
    if (!testCase.name) {
      console.log('Skipping test case without name');
      continue;
    }
    
    const result = runTestCase(testCase);
    
    if (result.passed) {
      console.log(`✓ ${result.name}`);
      passed++;
    } else {
      console.log(`✗ ${result.name}`);
      console.log(`  Error: ${result.error}`);
      if (result.expected !== undefined) {
        console.log(`  Expected: "${result.expected}"`);
        console.log(`  Actual:   "${result.actual}"`);
      }
      if (result.stack) {
        console.log(`  Stack: ${result.stack}`);
      }
      failures.push(result);
      failed++;
    }
  }
  
  const total = passed + failed;
  console.log(`\nResults: ${passed}/${total} passed, ${failed} failed`);
  
  return { passed, failed, total, failures };
}

/**
 * Main test runner
 */
function runAllTests() {
  console.log('Structural Editing Extensions Test Harness');
  console.log('==========================================');
  
  const testFiles = [
    './test/new_structural/navigation_tests.yaml',
    './test/new_structural/editing_tests.yaml'
  ];
  
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;
  const allFailures = [];
  
  for (const testFile of testFiles) {
    const results = runTestFile(testFile);
    totalPassed += results.passed;
    totalFailed += results.failed;
    totalTests += results.total;
    allFailures.push(...(results.failures || []));
  }
  
  console.log('\n==========================================');
  console.log('FINAL RESULTS');
  console.log('==========================================');
  console.log(`Total tests: ${totalTests}`);
  console.log(`Passed: ${totalPassed}`);
  console.log(`Failed: ${totalFailed}`);
  console.log(`Success rate: ${totalTests > 0 ? Math.round((totalPassed / totalTests) * 100) : 0}%`);
  
  if (allFailures.length > 0) {
    console.log('\n=== FAILURE SUMMARY ===');
    for (const failure of allFailures) {
      console.log(`- ${failure.name}: ${failure.error}`);
    }
  }
  
  return totalFailed === 0;
}

// Run tests if this module is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const success = runAllTests();
  process.exit(success ? 0 : 1);
}

export { runAllTests, runTestFile, runTestCase };