// Script to add missing descriptions to documentation functions
import fs from 'fs/promises';
import path from 'path';

// Documentation file paths
const DOC_FILE = 'src/data/documentation.json';
const ISSUES_FILE = 'src/data/documentation-issues.json';
const OUTPUT_FILE = 'src/data/documentation-enhanced.json';

/**
 * Main function to add descriptions to functions
 */
async function addMissingDescriptions() {
  try {
    console.log('Starting to add missing descriptions...');
    
    // Read documentation and issues files
    const documentation = JSON.parse(await fs.readFile(DOC_FILE, 'utf8'));
    const issues = JSON.parse(await fs.readFile(ISSUES_FILE, 'utf8'));
    
    // Count updated functions
    let updatedCount = 0;
    
    // Process each function with missing description
    for (const funcIssue of issues.missingDescription) {
      // Find function in documentation
      const funcIndex = documentation.findIndex(f => f.name === funcIssue.name);
      if (funcIndex === -1) continue;
      
      // Add description based on function name and category
      const description = generateDescription(
        funcIssue.name, 
        funcIssue.category, 
        documentation[funcIndex]
      );
      
      // Update documentation with new description
      if (description) {
        documentation[funcIndex].description = description;
        updatedCount++;
        console.log(`Added description for ${funcIssue.name}`);
      }
    }
    
    // Sort alphabetically to ensure consistent output
    documentation.sort((a, b) => a.name.localeCompare(b.name));
    
    // Create output directory if it doesn't exist
    try {
      await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    
    // Write updated documentation to file
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(documentation, null, 2));
    
    console.log(`Updated ${updatedCount} functions with descriptions`);
    console.log(`Enhanced documentation saved to ${OUTPUT_FILE}`);
    
    // Also update the original documentation file
    await fs.writeFile(DOC_FILE, JSON.stringify(documentation, null, 2));
    console.log(`Original documentation file updated: ${DOC_FILE}`);
  } catch (error) {
    console.error('Error adding descriptions:', error);
  }
}

/**
 * Generate a description for a function based on its name, category, and existing data
 * @param {string} name - Function name
 * @param {string} category - Function category
 * @param {Object} funcData - Existing function data
 * @returns {string} Generated description
 */
function generateDescription(name, category, funcData) {
  // Special handling for specific functions
  switch (name) {
    // Comparison operators
    case '<':
      return 'Compares two values and returns true if the first value is less than the second.';
    case '<=':
      return 'Compares two values and returns true if the first value is less than or equal to the second.';
    case '>':
      return 'Compares two values and returns true if the first value is greater than the second.';
    case '>=':
      return 'Compares two values and returns true if the first value is greater than or equal to the second.';
    case '=':
      return 'Compares two values and returns true if they are equal.';
    case '!=':
      return 'Compares two values and returns true if they are not equal.';
    
    // Math functions
    case '%':
      return 'Returns the remainder after division of the first argument by the second.';
    case 'pow':
      return 'Raises the first number to the power of the second number.';
    case 'ceil':
      return 'Rounds a number up to the nearest integer.';
    case 'floor':
      return 'Rounds a number down to the nearest integer.';
      
    // List operations
    case 'list':
      return 'Creates a new list containing the provided arguments.';
    case 'vec':
      return 'Creates a new vector (fixed-length array) containing the provided arguments.';
    case 'zeros':
      return 'Creates a new list filled with zeros of the specified length.';
    case 'first':
      return 'Returns the first element of a list or sequence.';
    case 'rest':
      return 'Returns a list containing all elements except the first one.';
    case 'push':
      return 'Adds one or more elements to the end of a list and returns the modified list.';
    case 'insert':
      return 'Inserts an element at the specified index in a list and returns the modified list.';
    case 'remove':
      return 'Removes an element at the specified index from a list and returns the modified list.';
    case 'index':
      return 'Returns the index of the first occurrence of an element in a list, or -1 if not found.';
    case 'slice':
      return 'Returns a new list containing elements from the start index up to but not including the end index.';
    case 'flatten':
      return 'Flattens a nested list structure into a single-level list.';
    
    // Higher-order functions
    case 'map':
      return 'Applies a function to each element in a list and returns a new list with the results.';
    case 'filter':
      return 'Returns a new list containing only the elements that satisfy the predicate function.';
    case 'range':
      return 'Generates a list of numbers from the start value (inclusive) to the end value (exclusive).';
    
    // Control flow
    case 'if':
      return 'Evaluates a condition and returns the result of the second expression if true, otherwise the third expression.';
    case 'do':
      return 'Evaluates each expression in sequence and returns the value of the last expression.';
    case 'for':
      return 'Iterates over a range of values, binding each value to a variable and evaluating the body expressions.';
    case 'while':
      return 'Repeatedly evaluates the body expressions as long as the condition is true, returning the last result.';
    
    // Variable binding and functions
    case 'let':
      return 'Creates a local scope with variable bindings that are available within the body expressions.';
    case 'set':
      return 'Assigns a new value to an existing variable.';
    case 'define':
      return 'Defines a global variable with the specified value.';
    case 'lambda':
      return 'Creates an anonymous function with the specified parameters and body.';
    case 'defun':
      return 'Defines a named function with the specified parameters and body.';
    
    // Unit conversion
    case 'uni->bi':
      return 'Converts a unipolar value (0 to 1) to a bipolar value (-1 to 1).';
    case 'bi->uni':
      return 'Converts a bipolar value (-1 to 1) to a unipolar value (0 to 1).';
    
    // Specialized functions
    case 'scale':
      return 'Scales a value from one range to another, mapping the input value proportionally.';
    case 'usin':
      return 'Produces a unipolar sine wave (0 to 1) for the given phase value.';
    
    default:
      // Generic descriptions based on category
      if (category === 'timing') {
        const timingMap = {
          'bar': 'Returns the current bar number in the performance timeline.',
          'beat': 'Returns the current beat number within the bar.',
          'bpm': 'Returns the current tempo in beats per minute.',
          'bps': 'Returns the current tempo in beats per second.',
          'phrase': 'Represents a phrase of music, typically consisting of multiple bars.',
          'section': 'Represents a section of music, typically consisting of multiple phrases.',
          'get-clock-source': 'Returns the current clock source (internal or external).',
          'reset-clock-ext': 'Resets the external clock to its initial state.',
          'reset-clock-int': 'Resets the internal clock to its initial state.',
          'set-bpm': 'Sets the tempo in beats per minute.',
          'set-clock-ext': 'Sets the system to use an external clock source.',
          'set-clock-int': 'Sets the system to use the internal clock source.',
          'set-time-sig': 'Sets the time signature for the performance.',
          't': 'Returns the current time value in seconds.',
          'time': 'Returns the current time value in the specified unit.'
        };
        return timingMap[name] || `A timing-related function for working with musical time.`;
      } else if (category === 'sequencing') {
        const sequencingMap = {
          'pulse': 'Generates a pulse wave with the specified frequency.',
          'sqr': 'Generates a square wave sequence with customizable parameters.',
          'step': 'Creates a step sequencer pattern with the given values.'
        };
        return sequencingMap[name] || `A sequencing function for creating musical patterns.`;
      } else if (category === 'outputs') {
        const outputsMap = {
          's[x]': 'Sends a value to the specified output channel.'
        };
        return outputsMap[name] || `An output function for routing signals to external destinations.`;
      }
      
      // Fallback for any remaining functions
      return `${name} function for ${category} operations.`;
  }
}

// Run the script
addMissingDescriptions(); 