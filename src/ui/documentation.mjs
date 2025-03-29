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
    console.log("Initializing documentation panel");
    const docPanel = document.getElementById('panel-documentation');
    
    // Verify panel exists
    if (!docPanel) {
        console.error("Documentation panel element not found in DOM!");
        return;
    } else {
        console.log("Documentation panel found in DOM:", docPanel);
    }
    
    // Load and render documentation data
    loadDocumentationData().then(data => {
        console.log("Documentation data loaded, count:", data.length);
        renderDocumentationPanel(docPanel, data);
    }).catch(error => {
        console.error("Error loading documentation data:", error);
    });
    
    // Remove previous handlers if any
    $("#button-documentation").off("click");
    
    // Add event handler for documentation button - using direct DOM for reliability
    const docButton = document.getElementById("button-documentation");
    if (docButton) {
        docButton.addEventListener("click", function(e) {
            console.log("Documentation button clicked - direct event listener");
            toggleAuxPanel("#panel-documentation");
            e.preventDefault();
            e.stopPropagation();
        });
    }
    
    // Verify button exists
    if ($("#button-documentation").length === 0) {
        console.error("Documentation button not found in DOM!");
    } else {
        console.log("Documentation button found in DOM:", $("#button-documentation")[0]);
    }
}

/**
 * Adjust documentation panel elements to ensure readability based on current theme
 */
function adjustDocPanelForTheme() {
    // Determine if we're using a light theme by checking the --text-primary variable
    const textColor = getComputedStyle(document.documentElement).getPropertyValue('--text-primary').trim();
    
    // Convert the color to RGB to check its brightness
    let isLightText = false;
    if (textColor.startsWith('#')) {
        // For hex color
        const hex = textColor.substring(1);
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        // Calculate perceived brightness
        const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
        isLightText = brightness > 128;
    } else if (textColor.startsWith('rgb')) {
        // For rgb color
        const rgb = textColor.match(/\d+/g);
        if (rgb && rgb.length >= 3) {
            const r = parseInt(rgb[0]);
            const g = parseInt(rgb[1]);
            const b = parseInt(rgb[2]);
            const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
            isLightText = brightness > 128;
        }
    }
    
    // If we have light text, we're in a dark theme, otherwise we're in a light theme
    const isLightTheme = !isLightText;
    
    if (isLightTheme) {
        // Adjust documentation panel elements for better visibility in light themes
        $('.doc-tag').css({
            'background-color': '#f0f0f0',
            'color': '#333'
        });
        
        $('.doc-tag.selected').css({
            'background-color': 'var(--accent-color, #0066cc)',
            'color': 'white'
        });
        
        $('.doc-function-header').css({
            'background-color': '#f5f5f5',
            'color': '#333'
        });
        
        $('.doc-function-details').css({
            'background-color': '#fafafa',
            'color': '#333',
            'border-top': '1px solid #ddd'
        });
        
        $('.doc-section-title').css({
            'color': 'var(--accent-color, #0066cc)'
        });
        
        $('.doc-param-name').css({
            'background-color': '#f0f0f0',
            'color': '#333',
            'border': '1px solid #ddd'
        });
        
        $('.doc-function-tag').css({
            'background-color': '#f0f0f0',
            'color': '#555'
        });
        
        // Override CodeMirror styles for examples
        $('.doc-example-editor .cm-editor').css({
            'background-color': '#f8f8f8',
            'border': '1px solid #eee'
        });
    } else {
        // Reset to dark theme defaults
        $('.doc-tag').css({
            'background-color': 'var(--panel-item-hover-bg)',
            'color': 'var(--text-primary)'
        });
        
        $('.doc-tag.selected').css({
            'background-color': 'var(--accent-color)',
            'color': '#000'
        });
        
        $('.doc-function-header').css({
            'background-color': 'var(--panel-section-bg)',
            'color': 'var(--text-primary)'
        });
        
        $('.doc-function-details').css({
            'background-color': 'var(--panel-control-bg)',
            'color': 'var(--text-primary)',
            'border-top': '1px solid var(--panel-border)'
        });
        
        $('.doc-section-title').css({
            'color': 'var(--accent-color)'
        });
        
        $('.doc-param-name').css({
            'background-color': 'var(--panel-item-hover-bg)',
            'color': 'var(--text-primary)',
            'border': 'none'
        });
        
        $('.doc-function-tag').css({
            'background-color': 'var(--panel-item-hover-bg)',
            'color': 'var(--text-primary)'
        });
        
        // Reset CodeMirror styles
        $('.doc-example-editor .cm-editor').css({
            'background-color': '',
            'border': ''
        });
    }
}

/**
 * Load documentation data from the imported JSON
 * This function was missing, causing the documentation panel to break
 */
async function loadDocumentationData() {
  try {
    // We're already importing documentationData at the top of the file
    // Let's load user preferences first
    loadUserPreferences();
    
    // Return the imported documentationData
    return documentationData;
    
  } catch (error) {
    console.error('Error loading documentation data:', error);
    return [];
  }
}

/**
 * Render the documentation panel with the loaded data
 * This function was missing, causing the documentation panel to be empty
 */
function renderDocumentationPanel(container, data) {
  if (!container) {
    console.error('Documentation panel container not found');
    return;
  }
  
  // Create tags container at the top
  const tagsContainer = document.createElement('div');
  tagsContainer.className = 'doc-tags-container';
  container.appendChild(tagsContainer);
  
  // Initialize tags
  initTags(tagsContainer);
  
  // Create function list container
  const functionListContainer = document.createElement('div');
  functionListContainer.id = 'doc-function-list';
  functionListContainer.className = 'doc-function-list';
  container.appendChild(functionListContainer);
  
  // Render the function list
  renderFunctionList(true);
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
  if (!container) {
    console.error('Documentation function list container not found');
    return;
  }
  
  // Clear existing content and editors
  container.innerHTML = '';
  codeEditors.forEach((editor) => {
    editor.destroy();
  });
  codeEditors.clear();
  
  // Get all functions, whether filtered or not
  let filteredFunctions = [...documentationData];
  
  // Apply tag filtering only if tags are selected
  if (selectedTags.length > 0) {
    filteredFunctions = documentationData.filter(func => {
      return func.tags && func.tags.some(tag => selectedTags.includes(tag));
    });
  }
  
  // Apply sorting
  if (applySorting) {
    filteredFunctions.sort((a, b) => {
      const aIsStarred = starredFunctions.includes(a.name);
      const bIsStarred = starredFunctions.includes(b.name);
      if (aIsStarred && !bIsStarred) return -1;
      if (!aIsStarred && bIsStarred) return 1;
      return a.name.localeCompare(b.name);
    });
  }
  
  // Check if we're in centered mode
  const docPanel = document.getElementById('panel-documentation');
  const isMultiColumn = docPanel && docPanel.classList.contains('centered');
  
  // Set container styles
  Object.assign(container.style, {
    display: 'flex',
    flexDirection: isMultiColumn ? 'row' : 'column',
    gap: '1em',
    width: '100%',
    minHeight: '100px',
    padding: '0.5em',
    boxSizing: 'border-box',
    overflowY: 'auto'
  });

  if (isMultiColumn) {
    // Multi-column layout
    const columnCount = 3;
    const itemsPerColumn = Math.ceil(filteredFunctions.length / columnCount);
    
    // Create columns
    const columns = [];
    for (let i = 0; i < columnCount; i++) {
      const columnContainer = document.createElement('div');
      columnContainer.className = 'doc-column';
      columnContainer.setAttribute('data-column-index', i);
      Object.assign(columnContainer.style, {
        display: 'flex',
        flexDirection: 'column',
        visibility: 'visible',
        opacity: '1',
        flex: '1 1 0',
        minWidth: '200px',
        width: 'auto',
        padding: '0.5em',
        boxSizing: 'border-box'
      });
      container.appendChild(columnContainer);
      columns.push(columnContainer);
    }
    
    // Distribute functions across columns
    filteredFunctions.forEach((func, index) => {
      const columnIndex = Math.floor(index / itemsPerColumn);
      const functionElement = createFunctionElement(func);
      columns[Math.min(columnIndex, columnCount - 1)].appendChild(functionElement);
    });
  } else {
    // Single column layout
    const column = document.createElement('div');
    column.className = 'doc-column';
    Object.assign(column.style, {
      display: 'flex',
      flexDirection: 'column',
      visibility: 'visible',
      opacity: '1',
      width: '100%',
      padding: '0.5em',
      boxSizing: 'border-box'
    });
    container.appendChild(column);
    
    // Add all functions to the single column
    filteredFunctions.forEach(func => {
      const functionElement = createFunctionElement(func);
      column.appendChild(functionElement);
    });
  }
  
  // Show no results message if needed
  if (filteredFunctions.length === 0) {
    const noResults = document.createElement('div');
    noResults.className = 'doc-no-results';
    noResults.textContent = 'No functions match the selected tags';
    container.appendChild(noResults);
  }
  
  // Initialize code editors after a short delay to ensure DOM is ready
  setTimeout(setupCodeEditors, 100);
}

function createFunctionElement(func) {
  const functionElement = document.createElement('div');
  functionElement.className = 'doc-function-item';
  
  // Set explicit styles for function element
  Object.assign(functionElement.style, {
    display: 'block',
    visibility: 'visible',
    width: '100%',
    marginBottom: '0.5em',
    backgroundColor: 'var(--panel-section-bg)',
    borderRadius: 'var(--item-border-radius)',
    border: '1px solid var(--panel-border)',
    overflow: 'hidden',
    boxSizing: 'border-box'
  });
  
  // Function header (always visible)
  const functionHeader = document.createElement('div');
  functionHeader.className = 'doc-function-header';
  functionHeader.dataset.function = func.name;
  
  // Set explicit styles for header
  Object.assign(functionHeader.style, {
    display: 'flex',
    visibility: 'visible',
    alignItems: 'center',
    padding: '0.5em',
    width: '100%',
    boxSizing: 'border-box',
    cursor: 'pointer',
    backgroundColor: 'var(--panel-section-bg)',
    color: 'var(--text-primary)'
  });
  
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
    saveUserPreferences();
    pendingSort = true;
  });
  
  // Function name
  const functionName = document.createElement('span');
  functionName.className = 'doc-function-name';
  functionName.textContent = func.name;
  functionName.dataset.name = func.name;
  
  // Set explicit styles for function name
  Object.assign(functionName.style, {
    visibility: 'visible',
    color: 'var(--text-primary)',
    flex: '1',
    minWidth: '0'
  });
  
  // Add aliases if any
  if (func.aliases && func.aliases.length > 0) {
    const aliasSpan = document.createElement('span');
    aliasSpan.className = 'doc-function-alias';
    aliasSpan.textContent = ` (alias: ${func.aliases.join(', ')})`;
    functionName.appendChild(document.createTextNode(' '));
    functionName.appendChild(aliasSpan);
  }
  
  // Add expand/collapse indicator
  const expandIndicator = document.createElement('span');
  expandIndicator.className = 'doc-function-expand-indicator';
  expandIndicator.style.marginLeft = 'auto';
  expandIndicator.style.marginRight = '8px';
  expandIndicator.style.fontSize = '0.9em';
  expandIndicator.textContent = expandedFunctions[func.name] ? '▼' : '▶';
  expandIndicator.title = expandedFunctions[func.name] ? 'Collapse' : 'Expand';
  
  // Add elements to header
  functionHeader.appendChild(starButton);
  functionHeader.appendChild(functionName);
  functionHeader.appendChild(expandIndicator);
  
  // Add click handler
  functionHeader.addEventListener('click', () => {
    toggleDocumentation(func.name);
  });
  
  // Add header to function element
  functionElement.appendChild(functionHeader);
  
  // Function details
  const functionDetails = document.createElement('div');
  functionDetails.className = 'doc-function-details';
  functionDetails.style.display = expandedFunctions[func.name] ? 'block' : 'none';
  
  // Add description, parameters, examples, and tags
  if (func.description) {
    const description = document.createElement('div');
    description.className = 'doc-function-description';
    description.textContent = func.description;
    functionDetails.appendChild(description);
  }
  
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
  
  if (func.examples && func.examples.length > 0) {
    const examplesTitle = document.createElement('div');
    examplesTitle.className = 'doc-section-title';
    examplesTitle.textContent = 'Examples:';
    functionDetails.appendChild(examplesTitle);
    
    func.examples.forEach((example, index) => {
      const exampleWrapper = document.createElement('div');
      exampleWrapper.className = 'doc-example-wrapper';
      
      const toolbar = document.createElement('div');
      toolbar.className = 'doc-example-toolbar';
      
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
      
      toolbar.appendChild(copyButton);
      exampleWrapper.appendChild(toolbar);
      
      const editorContainer = document.createElement('div');
      editorContainer.className = 'doc-example-editor';
      editorContainer.id = `${func.name}-example-${index}`;
      exampleWrapper.appendChild(editorContainer);
      
      functionDetails.appendChild(exampleWrapper);
    });
  }
  
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
    .doc-example-editor {
      position: relative;
      width: 100%;
    }

    .doc-example-editor .cm-editor {
      height: auto;
      min-height: 20px;
      max-height: 150px;
      background-color: var(--panel-section-bg) !important;
      border: 1px solid var(--panel-border);
      border-radius: var(--item-border-radius);
      overflow: auto;
      width: 100%;
      box-sizing: border-box;
    }

    .doc-example-editor .cm-content,
    .doc-example-editor .cm-line {
      color: var(--text-primary) !important;
      font-family: var(--code-font) !important;
    }

    .doc-example-editor .cm-content {
      padding: 4px 8px;
    }

    .doc-example-editor .cm-gutters {
      background-color: var(--panel-control-bg) !important;
      border-right: 1px solid var(--panel-border) !important;
    }

    .doc-example-editor .cm-editor.cm-focused {
      outline: none !important;
      border-color: var(--accent-color) !important;
    }

    .doc-example-editor:hover {
      cursor: grab;
    }

    .doc-example-editor:active {
      cursor: grabbing;
    }

    /* Specific styles for centered mode */
    .centered .doc-example-editor .cm-editor {
      width: 100%;
      margin: 0;
    }

    /* Ensure text is readable in both modes */
    .doc-example-editor .cm-editor .ͼ1 {
      color: var(--text-primary) !important;
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
      
      container.innerHTML = '';

      // Create the example editor and attach it to the container
      const view = createEditor(example, baseExtensions);
      
      // Make it read-only
      view.contentDOM.setAttribute('contenteditable', 'false');
      
      // Add to container
      container.appendChild(view.dom);
      
      // Ensure the editor fills its container
      view.dom.style.width = '100%';
      view.dom.style.boxSizing = 'border-box';
      
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