/**
 * Test Harness for Structural Editing Extensions
 * 
 * This module loads YAML test files and runs them against the structural editing functions
 */

import fs from 'fs';
import yaml from 'js-yaml';
import {
  createStructuralEditor,
  selectByText,
  navigateNext,
  navigatePrevious,
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
  wrapInFunction
} from './newStructuralEditingExtensions.mjs';

/**
 * Action function mapping
 */
const actionMap = {
  // Navigation
  'next': navigateNext,
  'previous': navigatePrevious,
  'in': navigateIn,
  'out': navigateOut,
  'left': navigateLeft,
  'right': navigateRight,
  'up': navigateUp,
  'down': navigateDown,
  
  // Editing
  'delete': deleteExpression,
  'cut': cutExpression,
  'paste': pasteExpression,
  'paste_before': pasteExpressionBefore,
  
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
    // Create editor with initial code
    let state = createStructuralEditor(testCase.code);
    
    // Set initial selection if specified
    if (testCase.selection) {
      state = selectByText(state, testCase.selection);
      
      // Verify we selected the right thing
      const selectedText = getSelectedText(state);
      if (selectedText !== testCase.selection) {
        return {
          passed: false,
          name: testCase.name,
          error: `Failed to select "${testCase.selection}". Got "${selectedText}" instead.`,
          expected: testCase.selection,
          actual: selectedText
        };
      }
    }
    
    // Apply actions
    if (testCase.actions) {
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
    if (testCase.new_selection) {
      const finalSelection = getSelectedText(state);
      if (finalSelection !== testCase.new_selection) {
        return {
          passed: false,
          name: testCase.name,
          error: `Selection mismatch after actions`,
          expected: testCase.new_selection,
          actual: finalSelection,
          finalCode: finalCode
        };
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