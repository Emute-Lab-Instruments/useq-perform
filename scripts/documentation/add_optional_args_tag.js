import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Resolve __dirname for ES modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Path to the JSON file
const jsonFilePath = path.join(__dirname, '../../src/data/documentation_hand_edited.json');

// Read and parse the JSON file
const documentation = JSON.parse(fs.readFileSync(jsonFilePath, 'utf8'));

// Process each entry in the JSON file
documentation.forEach(entry => {
  if (entry.parameters && Array.isArray(entry.parameters)) {
    entry.parameters.forEach(param => {
      if (param.description && param.description.toLowerCase().includes('optional')) {
        // Add the "optional": true field
        param.optional = true;

        // Remove the word "optional" and surrounding brackets from the description
        param.description = param.description.replace(/\(optional\)\s*/i, '').replace(/optional\s*/i, '');
      }
    });
  }
});

// Write the updated JSON back to the file
fs.writeFileSync(jsonFilePath, JSON.stringify(documentation, null, 2), 'utf8');

console.log('Optional arguments have been updated successfully.');
