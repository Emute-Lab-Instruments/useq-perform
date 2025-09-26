import { createStructuralEditor, selectByText } from './newStructuralEditingExtensions.mjs';
import { runTestCase } from './testHarness.mjs';

// Test a complex insert sequence again
const testCase = {
  name: "insert, fill hole, and continue",
  code: "(+ 1)",
  selection: "1",
  actions: ["insert", "maths", "*", "apply_call", "type", "5", "next", "type", "3"],
  new_code: "(+ 1 (* 5 3))",
  new_selection: "3"
};

console.log("Testing complex insert sequence...");
const result = runTestCase(testCase);
console.log("Result:", result.passed ? "PASSED" : "FAILED");
if (!result.passed) {
  console.log("Error:", result.error);
  console.log("Expected:", result.expected);
  console.log("Actual:", result.actual);
}