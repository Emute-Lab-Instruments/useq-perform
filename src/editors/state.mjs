import { Compartment } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

export const themeCompartment = new Compartment();
export const fontSizeCompartment = new Compartment();

// Bracket related utilities and modified keymaps
const openingBracketChars = ["(", "[", "{"];
const closingBracketChars = [")", "]", "}"];
const bracketChars = openingBracketChars.concat(closingBracketChars);

/**
 * Check if two bracket characters match (open/close pair)
 * @param {string} char1 - First bracket character
 * @param {string} char2 - Second bracket character
 * @returns {boolean} True if characters form a matching bracket pair
 */
export function areMatchingBracketChars(char1, char2) {
    const idx1 = openingBracketChars.indexOf(char1);
    if (idx1 >= 0) {
        return char2 === closingBracketChars[idx1];
    }
    const idx2 = closingBracketChars.indexOf(char1);
    if (idx2 >= 0) {
        return char2 === openingBracketChars[idx2];
    }
    return false;
}

export const stateExtensions = [];

function createUpdateListener(storageConfig) {
    return EditorView.updateListener.of((update) => {
      if (update.docChanged && storageConfig.saveCodeLocally) {
        // Save to local storage when document changes
        localStorage.setItem('editorContent', update.state.doc.toString());
      }
    });
  }