import { toggleAuxPanel } from './ui.mjs';
import documentationData from '../data/documentation_hand_edited.json';
import { createEditor } from '../editors/main.mjs';
import { activeUserSettings } from '../utils/persistentUserSettings.mjs';
import { baseExtensions } from '../editors/extensions.mjs';

// Available tags for filtering
const availableTags = [
  'maths', 
  'sequencing', 
  'lists', 
  'timing', 
  'inputs', 
  'outputs', 
  'system', 
  'playback', 
  'scheduling', 
  'randomness', 
  'functional programming', 
  'evaluation control'
];

// State
let selectedTags = [];
let starredFunctions = [];
let expandedFunctions = {};
let codeEditors = new Map(); // Store code editor instances
let pendingSort = false; // Flag to determine if we need to sort on next panel toggle

/**
 * Initialize the documentation panel
 */
export function initDocumentationPanel() {
  const docPanel = document.getElementById('panel-documentation');
  
  // Create and add the toggle position button
  const togglePositionButton = document.createElement('button');
  togglePositionButton.id = 'panel-documentation-toggle-position';
  togglePositionButton.innerHTML = '⇄';
  togglePositionButton.title = 'Toggle panel position';
  // Remove inline positioning styles - let CSS handle it
  docPanel.appendChild(togglePositionButton);
  
  // Add toggle position functionality
  togglePositionButton.addEventListener('click', () => {
    docPanel.classList.toggle('centered');
    
    // Re-render to adjust the column layout
    renderFunctionList(false);
  });
  
  // Create tags container
  const tagsContainer = document.createElement('div');
  tagsContainer.id = 'doc-tags-container';
  tagsContainer.className = 'doc-tags-container';
  docPanel.appendChild(tagsContainer);
  
  // Create function list container
  const functionListContainer = document.createElement('div');
  functionListContainer.id = 'doc-function-list';
  functionListContainer.className = 'doc-function-list';
  docPanel.appendChild(functionListContainer);
  
  // Initialize the tags
  initTags(tagsContainer);
  
  // Load user preferences
  loadUserPreferences();
  
  // Render the function list
  renderFunctionList(true);
  
  // Handle ESC key to close documentation panel globally
  $(document).on('keydown', function(e) {
    if (e.key === 'Escape' && $("#panel-documentation").is(":visible")) {
      toggleAuxPanel("#panel-documentation");
    }
  });
  
  // Add event listener for panel visibility changes
  const observer = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
      if (mutation.attributeName === 'style') {
        const isVisible = $(docPanel).is(':visible');
        if (isVisible && pendingSort) {
          // Sort and render only when panel becomes visible after starring
          pendingSort = false;
          renderFunctionList(true);
        }
      }
    });
  });
  
  observer.observe(docPanel, { attributes: true });
}

/**
 * Initialize the filter tags
 */
function initTags(container) {
  // container.innerHTML = '<div class="doc-section-title">Filter by tags:</div>';
  
  const tagsWrapper = document.createElement('div');
  tagsWrapper.className = 'doc-tags-wrapper';
  container.appendChild(tagsWrapper);
  
  availableTags.forEach(tag => {
    const tagElement = document.createElement('div');
    tagElement.className = 'doc-tag';
    tagElement.textContent = tag;
    tagElement.addEventListener('click', () => {
      tagElement.classList.toggle('selected');
      
      if (tagElement.classList.contains('selected')) {
        selectedTags.push(tag);
      } else {
        selectedTags = selectedTags.filter(t => t !== tag);
      }
      
      renderFunctionList(false);
    });
    
    tagsWrapper.appendChild(tagElement);
  });
}

/**
 * Render the function list based on current filters
 * @param {boolean} applySorting - Whether to apply sorting by starred status
 */
function renderFunctionList(applySorting = false) {
  const container = document.getElementById('doc-function-list');
  container.innerHTML = '';
  
  // Destroy any existing code editors
  codeEditors.forEach((editor) => {
    editor.destroy();
  });
  codeEditors.clear();
  
  // Filter functions based on selected tags
  let filteredFunctions = [...documentationData];
  
  if (selectedTags.length > 0) {
    filteredFunctions = documentationData.filter(func => {
      // A function matches if it has at least one of the selected tags
      return func.tags && func.tags.some(tag => selectedTags.includes(tag));
    });
  }
  
  // Sort functions: first starred, then alphabetical (if applySorting is true)
  filteredFunctions.sort((a, b) => {
    if (applySorting) {
      const aIsStarred = starredFunctions.includes(a.name);
      const bIsStarred = starredFunctions.includes(b.name);
      
      if (aIsStarred && !bIsStarred) return -1;
      if (!aIsStarred && bIsStarred) return 1;
    }
    
    return a.name.localeCompare(b.name);
  });
  
  // Check if we're in centered mode (3-column) layout
  const isMultiColumn = document.getElementById('panel-documentation').classList.contains('centered');
  
  if (isMultiColumn) {
    // For multi-column layout, we need to distribute functions across columns manually
    // This ensures each column fills vertically before moving to the next column
    const columnCount = 3;
    const itemsPerColumn = Math.ceil(filteredFunctions.length / columnCount);
    
    // Create column containers
    for (let i = 0; i < columnCount; i++) {
      const columnContainer = document.createElement('div');
      columnContainer.className = 'doc-column';
      columnContainer.style.display = 'flex';
      columnContainer.style.flexDirection = 'column';
      columnContainer.style.gap = '1em';
      container.appendChild(columnContainer);
      
      // Fill this column with its share of functions
      const startIdx = i * itemsPerColumn;
      const endIdx = Math.min(startIdx + itemsPerColumn, filteredFunctions.length);
      
      for (let j = startIdx; j < endIdx; j++) {
        const functionElement = createFunctionElement(filteredFunctions[j]);
        columnContainer.appendChild(functionElement);
      }
    }
  } else {
    // Single column mode - add functions directly to container
    filteredFunctions.forEach(func => {
      const functionElement = createFunctionElement(func);
      container.appendChild(functionElement);
    });
  }
  
  // If no functions match the filters
  if (filteredFunctions.length === 0) {
    const noResults = document.createElement('div');
    noResults.className = 'doc-no-results';
    noResults.textContent = 'No functions match the selected tags';
    container.appendChild(noResults);
  }
  
  // Initialize CodeMirror instances for expanded functions
  setTimeout(() => {
    setupCodeEditors();
  }, 0);
}

/**
 * Create a function element for the list
 */
function createFunctionElement(func) {
  const functionElement = document.createElement('div');
  functionElement.className = 'doc-function-item';
  
  // Function header (always visible)
  const functionHeader = document.createElement('div');
  functionHeader.className = 'doc-function-header';
  
  // Star button
  const starButton = document.createElement('button');
  starButton.className = 'doc-star-button';
  starButton.innerHTML = starredFunctions.includes(func.name) ? '★' : '☆';
  starButton.title = starredFunctions.includes(func.name) ? 'Remove from favorites' : 'Add to favorites';
  starButton.addEventListener('click', (e) => {
    e.stopPropagation();
    
    if (starredFunctions.includes(func.name)) {
      starredFunctions = starredFunctions.filter(name => name !== func.name);
      starButton.innerHTML = '☆';
      starButton.title = 'Add to favorites';
    } else {
      starredFunctions.push(func.name);
      starButton.innerHTML = '★';
      starButton.title = 'Remove from favorites';
    }
    
    // Save starred functions to localStorage
    saveUserPreferences();
    
    // Mark for sorting on next panel toggle
    pendingSort = true;
  });
  
  // Function name
  const functionName = document.createElement('span');
  functionName.className = 'doc-function-name';
  functionName.textContent = func.name;
  functionName.dataset.name = func.name; // For finding it later
  
  // If it has aliases, add them
  if (func.aliases && func.aliases.length > 0) {
    const aliasSpan = document.createElement('span');
    aliasSpan.className = 'doc-function-alias';
    aliasSpan.textContent = `(alias: ${func.aliases.join(', ')})`;
    functionName.appendChild(document.createTextNode(' '));
    functionName.appendChild(aliasSpan);
  }
  
  // Add expand/collapse indicator
  const expandIndicator = document.createElement('span');
  expandIndicator.className = 'doc-function-expand-indicator';
  expandIndicator.style.marginLeft = 'auto';
  expandIndicator.style.marginRight = '8px';
  expandIndicator.style.fontSize = '0.9em';
  expandIndicator.textContent = expandedFunctions && expandedFunctions[func.name] ? '▼' : '▶';
  expandIndicator.title = expandedFunctions && expandedFunctions[func.name] ? 'Collapse' : 'Expand';
  
  // Add elements to header
  functionHeader.appendChild(starButton);
  functionHeader.appendChild(functionName);
  functionHeader.appendChild(expandIndicator);
  
  // Add click handler to toggle expansion
  functionHeader.dataset.function = func.name;
  functionHeader.className = 'doc-function-header';
  functionHeader.addEventListener('click', () => {
    console.log(`Clicking function ${func.name}, current state: ${expandedFunctions[func.name]}`);
    toggleDocumentation(func.name);
  });
  
  // Add header to function element
  functionElement.appendChild(functionHeader);
  
  // Function details (will be toggled by the click handler)
  const functionDetails = document.createElement('div');
  functionDetails.className = 'doc-function-details';
  functionDetails.style.display = expandedFunctions && expandedFunctions[func.name] ? 'block' : 'none';
  
  // Description
  if (func.description) {
    const description = document.createElement('div');
    description.className = 'doc-function-description';
    description.textContent = func.description;
    functionDetails.appendChild(description);
  }
  
  // Parameters
  if (func.parameters && func.parameters.length > 0) {
    const paramsTitle = document.createElement('div');
    paramsTitle.className = 'doc-section-title';
    paramsTitle.textContent = 'Parameters:';
    functionDetails.appendChild(paramsTitle);
    
    const paramsList = document.createElement('ul');
    paramsList.className = 'doc-params-list';
    
    func.parameters.forEach(param => {
      const paramItem = document.createElement('li');
      paramItem.className = 'doc-param-item';
      
      const paramName = document.createElement('span');
      paramName.className = 'doc-param-name';
      paramName.textContent = param.name;
      
      const paramDesc = document.createElement('span');
      paramDesc.className = 'doc-param-description';
      paramDesc.textContent = param.description;
      
      paramItem.appendChild(paramName);
      paramItem.appendChild(paramDesc);
      
      if (param.range) {
        const paramRange = document.createElement('span');
        paramRange.className = 'doc-param-range';
        paramRange.textContent = `Range: ${param.range}`;
        paramItem.appendChild(paramRange);
      }
      
      paramsList.appendChild(paramItem);
    });
    
    functionDetails.appendChild(paramsList);
  }
  
  // Examples
  if (func.examples && func.examples.length > 0) {
    const examplesTitle = document.createElement('div');
    examplesTitle.className = 'doc-section-title';
    examplesTitle.textContent = 'Examples:';
    functionDetails.appendChild(examplesTitle);
    
    func.examples.forEach((example, index) => {
      // Create wrapper div for each example
      const exampleWrapper = document.createElement('div');
      exampleWrapper.className = 'doc-example-wrapper';
      
      // Create toolbar for the example
      const toolbar = document.createElement('div');
      toolbar.className = 'doc-example-toolbar';
      
      // Add copy button
      const copyButton = document.createElement('button');
      copyButton.className = 'doc-example-copy';
      copyButton.innerHTML = '<span class="copy-icon">📋</span>';
      copyButton.title = 'Copy to clipboard';
      copyButton.addEventListener('click', () => {
        navigator.clipboard.writeText(example).then(() => {
          copyButton.classList.add('copied');
          setTimeout(() => {
            copyButton.classList.remove('copied');
          }, 1500);
        });
      });
      
      // Add the toolbar
      toolbar.appendChild(copyButton);
      exampleWrapper.appendChild(toolbar);
      
      // Create container for the code editor
      const editorContainer = document.createElement('div');
      editorContainer.className = 'doc-example-editor';
      editorContainer.id = `${func.name}-example-${index}`;
      exampleWrapper.appendChild(editorContainer);
      
      // Add the wrapper to the function details
      functionDetails.appendChild(exampleWrapper);
    });
  }
  
  // Tags
  if (func.tags && func.tags.length > 0) {
    const tagsContainer = document.createElement('div');
    tagsContainer.className = 'doc-function-tags';
    
    func.tags.forEach(tag => {
      const tagElement = document.createElement('span');
      tagElement.className = 'doc-function-tag';
      tagElement.textContent = tag;
      tagsContainer.appendChild(tagElement);
    });
    
    functionDetails.appendChild(tagsContainer);
  }
  
  functionElement.appendChild(functionDetails);
  
  return functionElement;
}

/**
 * Set up CodeMirror editors for all code examples in the UI
 */
function setupCodeEditors() {
  // Add global style for all code editors in documentation
  const globalStyle = document.createElement('style');
  globalStyle.textContent = `
    .doc-example-editor .cm-editor {
      height: auto;
      max-height: 150px;
      background-color: #f5f5f5; /* Light gray background */
      border-radius: 4px;
      overflow: auto;
    }
    .doc-example-editor .cm-editor .cm-content, 
    .doc-example-editor .cm-editor .cm-line {
      color: #333; /* Dark text */
      padding: 2px 4px;
    }
    .doc-example-editor .cm-editor .cm-gutters {
      background-color: #eee;
    }
  `;
  document.head.appendChild(globalStyle);

  // For each expanded function with examples
  Object.keys(expandedFunctions).forEach(funcName => {
    if (!expandedFunctions[funcName]) return;
    
    const func = documentationData.find(f => f.name === funcName);
    if (!func || !func.examples || !func.examples.length) return;
    
    func.examples.forEach((example, index) => {
      const editorId = `${funcName}-example-${index}`;
      const container = document.getElementById(editorId);
      
      if (!container) return;
      
      // Create a new editor using the createEditor function with baseExtensions
      const view = createEditor(example, baseExtensions);
      
      // Make it read-only
      view.contentDOM.setAttribute('contenteditable', 'false');
      
      // Add to container
      container.innerHTML = '';
      container.appendChild(view.dom);
      
      // Store the editor instance for cleanup
      codeEditors.set(editorId, view);
      
      // Make example draggable
      enableDragAndDrop(container, example);
    });
  });
}

/**
 * Enable drag and drop for code examples
 * @param {HTMLElement} element - The container element
 * @param {string} code - The code to be dragged
 */
function enableDragAndDrop(element, code) {
  element.setAttribute('draggable', 'true');
  
  element.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', code);
    e.dataTransfer.effectAllowed = 'copy';
    
    // Add visual cue
    element.classList.add('dragging');
  });
  
  element.addEventListener('dragend', () => {
    element.classList.remove('dragging');
  });
}

/**
 * Save user preferences to localStorage
 */
function saveUserPreferences() {
  try {
    localStorage.setItem('starredFunctions', JSON.stringify(starredFunctions));
    localStorage.setItem('expandedFunctions', JSON.stringify(expandedFunctions));
  } catch (error) {
    console.error('Error saving documentation preferences:', error);
  }
}

/**
 * Load user preferences from localStorage
 */
function loadUserPreferences() {
  try {
    // Initialize expandedFunctions as an empty object if not already
    if (!expandedFunctions) {
      expandedFunctions = {};
    }
    
    // Load starred functions
    const savedStarred = localStorage.getItem('starredFunctions');
    if (savedStarred) {
      starredFunctions = JSON.parse(savedStarred);
    }
    
    // Load expanded state
    const savedExpanded = localStorage.getItem('expandedFunctions');
    if (savedExpanded) {
      try {
        const parsedExpanded = JSON.parse(savedExpanded);
        // Only use the parsed value if it's an object
        if (parsedExpanded && typeof parsedExpanded === 'object') {
          expandedFunctions = parsedExpanded;
        }
      } catch (parseError) {
        console.error('Error parsing expandedFunctions from localStorage:', parseError);
        expandedFunctions = {};
      }
    }
  } catch (error) {
    console.error('Error loading documentation preferences:', error);
    // Ensure we have a valid expandedFunctions object
    expandedFunctions = {};
  }
}

/**
 * Function to handle keyboard shortcut for documentation
 * @param {*} editor CodeMirror editor instance
 */
export function showDocumentationForSymbol(editor) {
  if (!editor) return false;
  
  const cursor = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(cursor);
  const lineText = line.text;
  
  // Try to extract the symbol at the current cursor position
  let start = cursor - line.from;
  let end = start;
  
  // Move backward to find the start of the symbol
  while (start > 0 && /[\w-]/.test(lineText.charAt(start - 1))) {
    start--;
  }
  
  // Move forward to find the end of the symbol
  while (end < lineText.length && /[\w-]/.test(lineText.charAt(end))) {
    end++;
  }
  
  if (start < end) {
    const symbol = lineText.substring(start, end);
    
    // Find the matching function in documentation
    const func = documentationData.find(f => 
      f.name === symbol || (f.aliases && f.aliases.includes(symbol))
    );
    
    if (func) {
      // Show documentation panel
      toggleAuxPanel("#panel-documentation");
      
      // Expand the function
      expandedFunctions = {}; // Collapse all others
      expandedFunctions[func.name] = true;
      
      // Clear any tag filters
      selectedTags = [];
      document.querySelectorAll('.doc-tag').forEach(tag => {
        tag.classList.remove('selected');
      });
      
      // Render the updated list
      renderFunctionList(false);
      
      // Scroll to the function
      setTimeout(() => {
        const funcElements = document.querySelectorAll('.doc-function-name');
        for (const element of funcElements) {
          if (element.dataset.name === func.name) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            break;
          }
        }
      }, 100);
      
      return true;
    }
  }
  
  return false;
}

function toggleDocumentation(functionName) {
  console.log('Toggling documentation for:', functionName, 'Current state:', expandedFunctions[functionName]);
  
  // Ensure expandedFunctions is initialized
  if (!expandedFunctions) {
    expandedFunctions = {};
  }
  
  // Toggle the expanded state
  expandedFunctions[functionName] = !expandedFunctions[functionName];
  
  // Save to localStorage
  try {
    localStorage.setItem('expandedFunctions', JSON.stringify(expandedFunctions));
  } catch (error) {
    console.error('Error saving expanded state:', error);
  }
  
  // Update the UI
  const functionHeader = document.querySelector(`.doc-function-header[data-function="${functionName}"]`);
  if (functionHeader) {
    const detailsContainer = functionHeader.nextElementSibling;
    const expandIndicator = functionHeader.querySelector('.doc-function-expand-indicator');
    
    // Update expand indicator
    if (expandIndicator) {
      expandIndicator.textContent = expandedFunctions[functionName] ? '▼' : '▶';
      expandIndicator.title = expandedFunctions[functionName] ? 'Collapse' : 'Expand';
    }
    
    // Update details container visibility
    if (detailsContainer) {
      if (expandedFunctions[functionName]) {
        detailsContainer.style.display = 'block';
      } else {
        detailsContainer.style.display = 'none';
      }
    }
  }
  
  console.log('Toggled state:', functionName, expandedFunctions[functionName]);
}