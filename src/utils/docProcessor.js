const fs = require('fs').promises;
const path = require('path');

/**
 * Process markdown files to extract function documentation
 * @returns {Promise<Array>} Array of function documentation objects
 */
async function processDocFiles() {
  const docsDir = path.join(process.cwd(), '.local', 'documentation');
  const files = await fs.readdir(docsDir);
  const mdFiles = files.filter(file => file.endsWith('.md'));

  let allFunctions = [];

  for (const file of mdFiles) {
    const filePath = path.join(docsDir, file);
    const content = await fs.readFile(filePath, 'utf8');
    
    // Extract category from filename
    let category = file.replace('.md', '');
    if (category.startsWith('useq-')) {
      category = category.replace('useq-', '');
    } else if (category === 'modulisp-about') {
      category = 'modulisp';
    }
    
    // Process functions in the file
    const functions = extractFunctionsFromMarkdown(content, category);
    allFunctions = [...allFunctions, ...functions];
  }

  // Sort alphabetically by name
  return allFunctions.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Extract function documentation from markdown content
 * @param {string} markdown - The markdown content
 * @param {string} category - The category for the functions
 * @returns {Array} Array of function objects
 */
function extractFunctionsFromMarkdown(markdown, category) {
  const functions = [];
  
  // Find function definitions
  // Look for headers with function signatures like ### `functionName <param1> <param2>`
  const functionRegex = /###\s+`([^`]+)`\s*(?:\(.*?\))?\s*\n\n(.*?)(?=###|\n## |$)/gs;
  const matches = [...markdown.matchAll(functionRegex)];
  
  matches.forEach(match => {
    const signature = match[1];
    const content = match[2].trim();
    
    // Extract function name and parameters
    const nameParts = signature.split(' ');
    const name = nameParts[0];
    
    // Skip if not a function (some sections might match the pattern but aren't functions)
    if (!name || name.includes('---') || name.includes('permalink:')) {
      return;
    }
    
    // Extract description
    let description = '';
    const descriptionMatch = content.match(/^([^|]*?)(?=\||\n```|$)/s);
    if (descriptionMatch) {
      description = descriptionMatch[1].trim();
    }
    
    // Extract parameters
    const parameters = [];
    const paramTableRegex = /\| Parameter \| Description \|.*?\|(.*?)(?=\n\n|$)/s;
    const paramTableMatch = content.match(paramTableRegex);
    
    if (paramTableMatch) {
      const paramRows = paramTableMatch[1].split('\n').filter(row => row.includes('|'));
      paramRows.forEach(row => {
        const cells = row.split('|').map(cell => cell.trim()).filter(cell => cell);
        if (cells.length >= 2) {
          parameters.push({
            name: cells[0],
            description: cells[1],
            range: cells[2] || ''
          });
        }
      });
    }
    
    // Extract code examples
    const examples = [];
    const codeBlockRegex = /```(?:clojure)?\s*([\s\S]*?)```/g;
    let codeBlockMatch;
    while ((codeBlockMatch = codeBlockRegex.exec(content)) !== null) {
      examples.push(codeBlockMatch[1].trim());
    }
    
    // Figure out tags
    const tags = determineTagsFromCategory(category);
    
    // Add function information
    if (name) {
      // Check for alias
      const aliasMatch = signature.match(/\(alias:?\s+`?([^)`]+)`?\)/);
      const aliases = aliasMatch ? [aliasMatch[1]] : [];
      
      functions.push({
        name,
        aliases,
        description,
        parameters,
        examples,
        category,
        tags
      });
    }
  });
  
  return functions;
}

/**
 * Determine tags based on category and content
 * @param {string} category 
 * @returns {Array} Array of tags
 */
function determineTagsFromCategory(category) {
  const tags = [];
  
  switch (category) {
    case 'sequencing':
      tags.push('sequencing');
      break;
    case 'timing':
      tags.push('timing');
      break;
    case 'inputs':
      tags.push('inputs');
      break;
    case 'outputs':
      tags.push('outputs');
      break;
    case 'system':
      tags.push('system');
      break;
    case 'probabilistic':
      tags.push('randomness');
      break;
    case 'scheduling':
      tags.push('scheduling');
      break;
    case 'modulisp':
      tags.push('functional programming');
      tags.push('evaluation control');
      break;
  }
  
  return tags;
}

/**
 * Save processed functions to a JSON file
 */
async function generateFunctionsJSON() {
  try {
    const functions = await processDocFiles();
    const outputDir = path.join(process.cwd(), 'src', 'data');
    
    // Create directory if it doesn't exist
    try {
      await fs.mkdir(outputDir, { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    
    const outputFile = path.join(outputDir, 'documentation.json');
    await fs.writeFile(outputFile, JSON.stringify(functions, null, 2));
    
    console.log(`Documentation processed: ${functions.length} functions saved to ${outputFile}`);
  } catch (err) {
    console.error('Error processing documentation:', err);
  }
}

// Export for use in other modules
module.exports = {
  processDocFiles,
  generateFunctionsJSON
};

// Run directly if called from command line
if (require.main === module) {
  generateFunctionsJSON();
}