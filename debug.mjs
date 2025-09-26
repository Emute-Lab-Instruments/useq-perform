import { createStructuralEditor, selectByText } from './newStructuralEditingExtensions.mjs';
import { runTestCase } from './testHarness.mjs';

// Test a failing barf operation
const testCase = {
  name: "barf right - list expels last element",
  code: "(a b c)",
  selection: "(a b c)",
  actions: "barf_right",
  new_code: "(a b) c",
  new_selection: "(a b)"
};

console.log("Testing barf right...");
const result = runTestCase(testCase);
console.log("Result:", result.passed ? "PASSED" : "FAILED");
if (!result.passed) {
  console.log("Error:", result.error);
  console.log("Expected:", result.expected);
  console.log("Actual:", result.actual);
}