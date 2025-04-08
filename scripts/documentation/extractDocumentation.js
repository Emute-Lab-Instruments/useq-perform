// Script to extract function documentation from markdown files
import fs from 'fs/promises';
import path from 'path';

// Documentation source directory
const DOCS_DIR = '.local/documentation';
// Output file path
const OUTPUT_FILE = 'src/data/documentation.json';
// Report file path for documentation issues
const REPORT_FILE = 'src/data/documentation-issues.json';

/**
 * Main function to extract and save documentation
 */
async function extractDocumentation() {
  try {
    console.log('Starting documentation extraction...');
    
    // Get all markdown files from the docs directory
    const files = await fs.readdir(DOCS_DIR);
    const mdFiles = files.filter(file => file.endsWith('.md'));
    
    let allFunctions = [];
    
    // Process each file
    for (const file of mdFiles) {
      console.log(`Processing ${file}...`);
      const filePath = path.join(DOCS_DIR, file);
      const content = await fs.readFile(filePath, 'utf8');
      
      // Determine category from filename
      let category = file.replace('.md', '');
      if (category.startsWith('useq-')) {
        category = category.replace('useq-', '');
      } else if (category === 'modulisp-about') {
        category = 'modulisp';
      }
      
      console.log(`Category: ${category}`);
      
      // Extract functions from content
      const functions = extractFunctionsFromContent(content, category);
      console.log(`Found ${functions.length} functions in ${file}`);
      
      // Debug: Print the first few functions' descriptions
      for (let i = 0; i < Math.min(functions.length, 3); i++) {
        console.log(`Function: ${functions[i].name}, Description: "${functions[i].description ? functions[i].description.substring(0, 50) + '...' : 'MISSING'}"`);
      }
      
      // Also extract variable-style functions (like t, time, etc.)
      const variableFunctions = extractVariableFunctions(content, category);
      if (variableFunctions.length > 0) {
        console.log(`Found ${variableFunctions.length} variable-style functions`);
        // Debug: Print the first few variable functions' descriptions
        for (let i = 0; i < Math.min(variableFunctions.length, 3); i++) {
          console.log(`Variable Function: ${variableFunctions[i].name}, Description: "${variableFunctions[i].description ? variableFunctions[i].description.substring(0, 50) + '...' : 'MISSING'}"`);
        }
        functions.push(...variableFunctions);
      }
      
      allFunctions = [...allFunctions, ...functions];
    }
    
    // Remove duplicates based on name
    const uniqueFunctions = [];
    const nameSet = new Set();
    
    for (const func of allFunctions) {
      if (!nameSet.has(func.name)) {
        nameSet.add(func.name);
        uniqueFunctions.push(func);
      } else {
        // If there's a duplicate, merge with the existing one if possible
        const existingIndex = uniqueFunctions.findIndex(f => f.name === func.name);
        if (existingIndex >= 0) {
          const existing = uniqueFunctions[existingIndex];
          
          // Take description from non-empty one
          if (!existing.description && func.description) {
            existing.description = func.description;
          }
          
          // Merge parameters if needed
          if ((!existing.parameters || existing.parameters.length === 0) && 
              func.parameters && func.parameters.length > 0) {
            existing.parameters = func.parameters;
          }
          
          // Merge examples if needed
          if ((!existing.examples || existing.examples.length === 0) && 
              func.examples && func.examples.length > 0) {
            existing.examples = func.examples;
          }
          
          // Merge tags
          if (func.tags) {
            existing.tags = [...new Set([...(existing.tags || []), ...func.tags])];
          }
        }
      }
    }
    
    // Sort alphabetically
    uniqueFunctions.sort((a, b) => a.name.localeCompare(b.name));
    
    // Create directory if it doesn't exist
    try {
      await fs.mkdir(path.dirname(OUTPUT_FILE), { recursive: true });
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
    
    // Write to output file
    await fs.writeFile(OUTPUT_FILE, JSON.stringify(uniqueFunctions, null, 2));
    
    console.log(`Extraction complete. ${uniqueFunctions.length} functions saved to ${OUTPUT_FILE}`);
    
    // Generate report of functions with missing documentation
    const issuesReport = generateDocumentationIssuesReport(uniqueFunctions);
    await fs.writeFile(REPORT_FILE, JSON.stringify(issuesReport, null, 2));
    
    console.log(`Documentation issues report saved to ${REPORT_FILE}`);
    console.log(`Found ${issuesReport.missingDescription.length} functions without descriptions`);
    console.log(`Found ${issuesReport.missingExamples.length} functions without examples`);
    console.log(`Total functions with issues: ${issuesReport.totalWithIssues}`);
    
    // Debug: Print a few functions with missing descriptions
    if (issuesReport.missingDescription.length > 0) {
      console.log('Some functions with missing descriptions:');
      for (let i = 0; i < Math.min(issuesReport.missingDescription.length, 5); i++) {
        const func = issuesReport.missingDescription[i];
        console.log(`  - ${func.name} (${func.category})`);
      }
    }
  } catch (error) {
    console.error('Error extracting documentation:', error);
  }
}

/**
 * Extract variable-style functions from markdown content (like t, time, etc.)
 * @param {string} content - Markdown content
 * @param {string} category - Documentation category
 * @returns {Array} Array of function objects
 */
function extractVariableFunctions(content, category) {
  const functions = [];
  
  // Look for variable sections with headers like "### `variable`"
  const variableRegex = /###\s+`([^`]+)`\s*\n\n([^#]+)/g;
  let match;
  
  while ((match = variableRegex.exec(content)) !== null) {
    const name = match[1].trim();
    let description = match[2].trim();
    
    // Process description based on category
    if (category === 'modulisp') {
      // For ModuLisp docs, check if there's a table
      if (description.includes('|')) {
        // Find the table
        const tableMatch = description.match(/\|.*\|.*\|.*\|[\s\S]*?(?=```|\n\n|$)/);
        if (tableMatch) {
          // Get text after the table
          const afterTable = description.substring(tableMatch.index + tableMatch[0].length).trim();
          
          // Extract text before the first code block if there is one
          if (afterTable) {
            const beforeCodeMatch = afterTable.match(/^([\s\S]*?)(?=```|$)/s);
            if (beforeCodeMatch && beforeCodeMatch[1].trim()) {
              description = beforeCodeMatch[1].trim();
            }
          }
        }
      }
    } else {
      // For other categories - standard behavior
      // If there's a table, only use the text before it
      if (description.includes('|')) {
        const beforeTableMatch = description.match(/^([\s\S]*?)(?=\|)/);
        if (beforeTableMatch) {
          description = beforeTableMatch[1].trim();
        }
      }
      
      // Similarly handle code blocks
      if (description.includes('```')) {
        const beforeCodeMatch = description.match(/^([\s\S]*?)(?=```)/s);
        if (beforeCodeMatch) {
          description = beforeCodeMatch[1].trim();
        }
      }
    }
    
    // Check if this looks like a variable-style function
    // Only process if it's a simple name without parameters in the signature
    if (name && !name.includes(' ') && !name.includes('<')) {
      functions.push({
        name,
        aliases: [],
        description,
        parameters: [],
        examples: [],
        category,
        tags: determineTagsFromCategoryAndContent(category, description, name)
      });
    }
  }
  
  // For certain files, also look for variables within sections
  if (category === 'timing') {
    // Try to find "## Timing Variables" section
    const varSectionMatch = content.match(/## Timing Variables\s+([\s\S]*?)(?=##|$)/);
    if (varSectionMatch) {
      const varSection = varSectionMatch[1];
      // Extract variables with their descriptions
      const varExtractRegex = /###\s+`([^`]+)`\s*\n\n([^#]+)/g;
      let varMatch;
      
      while ((varMatch = varExtractRegex.exec(varSection)) !== null) {
        const name = varMatch[1].trim();
        let description = varMatch[2].trim();
        
        // Process description based on category
        if (category === 'modulisp') {
          // For ModuLisp docs, check if there's a table
          if (description.includes('|')) {
            // Find the table
            const tableMatch = description.match(/\|.*\|.*\|.*\|[\s\S]*?(?=```|\n\n|$)/);
            if (tableMatch) {
              // Get text after the table
              const afterTable = description.substring(tableMatch.index + tableMatch[0].length).trim();
              
              // Extract text before the first code block if there is one
              if (afterTable) {
                const beforeCodeMatch = afterTable.match(/^([\s\S]*?)(?=```|$)/s);
                if (beforeCodeMatch && beforeCodeMatch[1].trim()) {
                  description = beforeCodeMatch[1].trim();
                }
              }
            }
          }
        } else {
          // For other categories - standard behavior
          // If there's a table, only use the text before it
          if (description.includes('|')) {
            const beforeTableMatch = description.match(/^([\s\S]*?)(?=\|)/);
            if (beforeTableMatch) {
              description = beforeTableMatch[1].trim();
            }
          }
          
          // Similarly handle code blocks
          if (description.includes('```')) {
            const beforeCodeMatch = description.match(/^([\s\S]*?)(?=```)/s);
            if (beforeCodeMatch) {
              description = beforeCodeMatch[1].trim();
            }
          }
        }
        
        functions.push({
          name,
          aliases: [],
          description,
          parameters: [],
          examples: [],
          category,
          tags: determineTagsFromCategoryAndContent(category, description, name)
        });
      }
    }
  }
  
  return functions;
}

/**
 * Generate a report of functions with documentation issues
 * @param {Array} functions - Array of function objects
 * @returns {Object} Report object with lists of problematic functions
 */
function generateDocumentationIssuesReport(functions) {
  const missingDescription = [];
  const missingExamples = [];
  const functionsWithIssues = new Set();
  
  functions.forEach(func => {
    let hasIssue = false;
    
    // Debug: Log the description check
    console.log(`Checking description for ${func.name}: ${func.description ? 'Has description' : 'MISSING'}`);
    if (func.description) {
      console.log(`  Length: ${func.description.length}, First 20 chars: "${func.description.substring(0, 20)}..."`);
    }
    
    // Check for missing description
    if (!func.description || func.description.trim() === '') {
      missingDescription.push({
        name: func.name,
        category: func.category
      });
      hasIssue = true;
    }
    
    // Check for missing examples
    if (!func.examples || func.examples.length === 0) {
      missingExamples.push({
        name: func.name,
        category: func.category
      });
      hasIssue = true;
    }
    
    if (hasIssue) {
      functionsWithIssues.add(func.name);
    }
  });
  
  return {
    missingDescription,
    missingExamples,
    totalWithIssues: functionsWithIssues.size
  };
}

/**
 * Extract functions from markdown content
 * @param {string} content - Markdown content
 * @param {string} category - Documentation category
 * @returns {Array} Array of function objects
 */
function extractFunctionsFromContent(content, category) {
  const functions = [];
  
  // Match function headers like ### `function-name <param>` and capture content until next header
  const functionRegex = /###\s+`([^`]+)`\s*(?:\(.*?\))?\s*\n\n(.*?)(?=###|\n## |$)/gs;
  const matches = [...content.matchAll(functionRegex)];
  
  for (const match of matches) {
    const signature = match[1];
    const functionBody = match[2].trim();
    
    // Check if it has parameters in the signature (space or <)
    const hasParams = signature.includes(' ') || signature.includes('<');
    
    // Extract function name (first word in signature)
    const nameParts = signature.split(' ');
    const name = nameParts[0];
    
    // Skip if not a valid function
    if (!name || name.includes('---') || name.includes('permalink:')) {
      continue;
    }
    
    // Extract parameters from the parameter table if it exists
    const tableParams = extractParametersFromTable(functionBody);
    
    // Extract description - special handling for different documentation formats
    let description = '';
    
    // First check if there's a parameter table
    const hasParameterTable = functionBody.includes('| Parameter ') || 
                             functionBody.includes('|-----------|') ||
                             functionBody.includes('| --- |');
    
    if (category === 'modulisp') {
      // ModuLisp files have a different structure:
      // For ModuLisp file, description often comes AFTER the parameter table
      if (hasParameterTable) {
        // Find the parameter table
        const tableMatch = functionBody.match(/\|.*\|.*\|.*\|[\s\S]*?(?=```|\n\n|$)/);
        if (tableMatch) {
          // Get text after the table
          const afterTable = functionBody.substring(tableMatch.index + tableMatch[0].length).trim();
          
          // Extract text before the first code block if there is one
          if (afterTable) {
            const beforeCodeMatch = afterTable.match(/^([\s\S]*?)(?=```|$)/s);
            if (beforeCodeMatch && beforeCodeMatch[1].trim()) {
              description = beforeCodeMatch[1].trim();
            }
          }
        }
      }
      
      // If no description found after table, try general approach
      if (!description) {
        // Try to get text before first code block or table
        const beforeTableOrCodeMatch = functionBody.match(/^([\s\S]*?)(?=\||```|$)/s);
        if (beforeTableOrCodeMatch && beforeTableOrCodeMatch[1].trim()) {
          description = beforeTableOrCodeMatch[1].trim();
        }
      }
    } else {
      // For non-ModuLisp files, description usually comes before the parameter table
      if (hasParameterTable) {
        const beforeTableMatch = functionBody.match(/^([\s\S]*?)(?=\|)/);
        if (beforeTableMatch) {
          description = beforeTableMatch[1].trim();
        }
      } else {
        // No table, try to get text before first code block
        const beforeCodeMatch = functionBody.match(/^([\s\S]*?)(?=```|$)/s);
        if (beforeCodeMatch) {
          description = beforeCodeMatch[1].trim();
        }
      }
    }
    
    console.log(`Extracted description for ${name}: Length=${description.length}, First 30 chars: "${description.substring(0, 30)}..."`);
    
    // Extract signature parameters if the function has them
    // This extracts parameters from the function signature for functions like (< a b)
    const signatureParams = [];
    if (nameParts.length > 1) {
      for (let i = 1; i < nameParts.length; i++) {
        const param = nameParts[i].replace(/[<>]/g, '').trim();
        if (param) {
          signatureParams.push({
            name: param,
            description: `Parameter ${i} of function ${name}`,
            range: ''
          });
        }
      }
    }
    
    // Use table params if available, otherwise fall back to signature params
    const parameters = tableParams.length > 0 ? tableParams : signatureParams;
    
    // Extract code examples
    const examples = [];
    const codeBlockRegex = /```(?:clojure)?\s*([\s\S]*?)```/g;
    let codeMatch;
    while ((codeMatch = codeBlockRegex.exec(functionBody)) !== null) {
      const example = codeMatch[1].trim();
      if (example) {
        examples.push(example);
      }
    }
    
    // Check for aliases
    const aliasMatch = signature.match(/\(alias:?\s+`?([^)`]+)`?\)/);
    const aliases = aliasMatch ? aliasMatch[1].split(',').map(s => s.trim()) : [];
    
    // Assign tags based on category and content
    const tags = determineTagsFromCategoryAndContent(category, functionBody, name);
    
    // Only add to functions if it has parameters (otherwise it might be a variable)
    // or if it's definitely a function based on some keywords
    if (hasParams || functionBody.includes('Returns') || functionBody.includes('function') ||
        functionBody.includes('parameters') || functionBody.includes('evaluates')) {
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
  }
  
  return functions;
}

/**
 * Extract parameters from markdown table
 * @param {string} content - Function body content
 * @returns {Array} Array of parameter objects
 */
function extractParametersFromTable(content) {
  const parameters = [];
  
  // Match parameter table with different header formats
  const tableRegex = /\|\s*([^|]*Parameter[^|]*)\s*\|\s*([^|]*Description[^|]*)\s*\|.*?\n(?:\s*\|[^\n]*\n)+/g;
  const tableMatches = [...content.matchAll(tableRegex)];
  
  if (tableMatches.length > 0) {
    for (const tableMatch of tableMatches) {
      const tableContent = tableMatch[0];
      
      // Get rows excluding header and separator
      const rows = tableContent.split('\n')
        .filter(line => line.trim().startsWith('|')) // Only include table rows
        .slice(2); // Skip header and separator rows
      
      for (const row of rows) {
        if (!row.includes('|')) continue;
        
        // Split by | and remove empty parts and whitespace
        const cells = row.split('|')
          .map(cell => cell.trim())
          .filter(cell => cell);
        
        if (cells.length >= 2) {
          parameters.push({
            name: cells[0],
            description: cells[1],
            range: cells[2] || ''
          });
        }
      }
    }
  }
  
  return parameters;
}

/**
 * Determine tags based on category and content
 * @param {string} category - Document category
 * @param {string} content - Function content
 * @param {string} functionName - Name of the function
 * @returns {Array} Array of tags
 */
function determineTagsFromCategoryAndContent(category, content, functionName) {
  const tags = new Set();
  
  // Add tag based on category
  switch (category) {
    case 'sequencing':
      tags.add('sequencing');
      break;
    case 'timing':
      tags.add('timing');
      break;
    case 'inputs':
      tags.add('inputs');
      break;
    case 'outputs':
      tags.add('outputs');
      break;
    case 'system':
      tags.add('system');
      break;
    case 'probabilistic':
      tags.add('randomness');
      break;
    case 'scheduling':
      tags.add('scheduling');
      break;
    case 'modulisp':
      tags.add('functional programming');
      break;
  }
  
  // Add additional tags based on content keywords
  if (content.includes('list') || content.includes('array') || functionName.includes('list')) {
    tags.add('lists');
  }
  
  if (content.includes('math') || content.includes('arithmetic') || 
      functionName.match(/^(add|sub|mul|div|mod|pow|sqrt|sin|cos|tan|abs|neg|round|floor|ceil)/) ||
      ['<', '>', '<=', '>=', '=', '+', '-', '*', '/'].includes(functionName)) {
    tags.add('maths');
  }
  
  if (content.includes('play') || content.includes('stop') || 
      content.includes('start') || content.includes('rewind')) {
    tags.add('playback');
  }
  
  if (content.includes('if') || content.includes('do ') || 
      content.includes('for ') || content.includes('when ')) {
    tags.add('evaluation control');
  }
  
  return [...tags];
}

// Run the script
extractDocumentation();