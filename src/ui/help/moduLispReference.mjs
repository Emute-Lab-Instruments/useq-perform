import { dbg } from "../../utils.mjs";
import { createEditor, createExampleEditor } from "../../editors/main.mjs";
import { baseExtensions } from "../../editors/extensions.mjs";
import { marked } from "marked";
import { EditorView } from "@codemirror/view";
import { setTheme } from "../../editors/themes/themeManager.mjs";
import { activeUserSettings } from "../../utils/persistentUserSettings.mjs";

// State management
const state = {
  data: null,
  selectedTags: new Set(),
  starredFunctions: new Set(),
  expandedFunctions: new Set(),
  isDevMode: false
};

export async function makeModuLispReference() {
  dbg("makeModuLispReference", "Initializing ModuLisp reference panel");
  const $container = $('<div>', {
    class: 'modulisp-reference-container' 
  });
  dbg("makeModuLispReference", "Created container with classes", $container.attr('class'));
  dbg("makeModuLispReference", "Container element", $container[0]);

  try {
    dbg("makeModuLispReference", "Loading user preferences");
    loadUserPreferences();

    dbg("makeModuLispReference", "Loading reference data");
    const data = await loadReferenceData();
    if (!data || !Array.isArray(data)) {
      throw new Error('Failed to load valid documentation data');
    }
    state.data = data;
    dbg("makeModuLispReference", "Reference data loaded", data);

    dbg("makeModuLispReference", "Creating tags");
    $container.append(makeTags(data));

    dbg("makeModuLispReference", "Creating function list");
    $container.append(makeFunctionList(data, 1));

    dbg("makeModuLispReference", "Final container classes", $container.attr('class'));
    dbg("makeModuLispReference", "Final container element", $container[0]);
    return $container;
  } catch (error) {
    dbg("makeModuLispReference", "Error creating reference panel", error);
    console.error("Error creating reference panel:", error);
    
    const $errorMessage = $('<div>', {
      class: 'doc-error-message',
      text: 'Failed to load documentation data. Please try refreshing the page.'
    }).css({
      padding: '1em',
      margin: '1em',
      backgroundColor: 'var(--error-bg, #ffebee)',
      color: 'var(--error-text, #c62828)',
      borderRadius: '4px'
    });
    $container.append($errorMessage);
    
    return $container;
  }
}


// Main function to create the ModuLisp reference pane

// Load user preferences from localStorage
function loadUserPreferences() {
  dbg("loadUserPreferences", "Loading preferences from localStorage");
  try {
    const savedStarred = localStorage.getItem("starredFunctions");
    if (savedStarred) {
      const parsedStarred = JSON.parse(savedStarred);
      state.starredFunctions = new Set(Array.isArray(parsedStarred) ? parsedStarred : []);
    }

    const savedExpanded = localStorage.getItem("expandedFunctions");
    if (savedExpanded) {
      const parsedExpanded = JSON.parse(savedExpanded);
      state.expandedFunctions = new Set(Array.isArray(parsedExpanded) ? parsedExpanded : []);
    }
    dbg("loadUserPreferences", "Preferences loaded", {
      starredFunctions: state.starredFunctions,
      expandedFunctions: state.expandedFunctions
    });
  } catch (error) {
    dbg("loadUserPreferences", "Error loading preferences", error);
    // Reset to empty sets on error
    state.starredFunctions = new Set();
    state.expandedFunctions = new Set();
  }
}

// Save user preferences to localStorage
function saveUserPreferences() {
  dbg("saveUserPreferences", "Saving preferences to localStorage");
  try {
    localStorage.setItem("starredFunctions", JSON.stringify(Array.from(state.starredFunctions)));
    localStorage.setItem("expandedFunctions", JSON.stringify(Array.from(state.expandedFunctions)));
    dbg("saveUserPreferences", "Preferences saved");
  } catch (error) {
    dbg("saveUserPreferences", "Error saving preferences", error);
  }
}

// Create a tag element
function makeTagElement(tag) {
  dbg("makeTagElement", "Creating tag element", tag);
  const $tag = $('<div>', {
    class: 'doc-tag',
    text: tag
  });

  if (state.selectedTags.has(tag)) {
    $tag.addClass('selected');
  }

  $tag.on('click', () => {
    dbg("makeTagElement", "Tag clicked", tag);
    if (state.selectedTags.has(tag)) {
      state.selectedTags.delete(tag);
      $tag.removeClass('selected');
    } else {
      state.selectedTags.add(tag);
      $tag.addClass('selected');
    }
    renderFunctionList();
  });

  return $tag;
}

// Create a tags container
function makeTagsContainer() {
  const $container = $('<div>', {
    class: 'doc-tags-container'
  });

  const $wrapper = $('<div>', {
    class: 'doc-tags-wrapper'
  });

  // Get all unique tags from the documentation data
  const allTags = new Set();
  state.data.forEach(func => {
    if (func && func.tags) {
      func.tags.forEach(tag => allTags.add(tag));
    }
  });

  // Sort tags alphabetically and create tag elements
  Array.from(allTags).sort().forEach(tag => {
    $wrapper.append(makeTagElement(tag));
  });

  $container.append($wrapper);
  return $container;
}

// Create a code editor for examples
function makeCodeEditor(code, id) {
  dbg("makeCodeEditor", "Creating code editor", { code, id });
  const $container = $('<div>', {
    class: 'doc-example-editor',
    id: `code-${id}`
  });

  // Create the editor using our own function
  const editor = createExampleEditor(code, $container[0]);
  dbg("Documentation Tab", "makeCodeEditor", "Created editor", editor);
  dbg("Documentation Tab", "makeCodeEditor", "Active user settings", activeUserSettings);
  dbg("Documentation Tab", "makeCodeEditor", "Setting theme", activeUserSettings.editor.theme);
  // setTheme(editor, activeUserSettings.editor.theme);

  // Make example draggable
  $container.attr('draggable', 'true');
  $container.on('dragstart', (e) => {
    e.dataTransfer.setData('text/plain', code);
    e.dataTransfer.effectAllowed = 'copy';
    $container.addClass('dragging');
  });
  $container.on('dragend', () => {
    $container.removeClass('dragging');
  });

  return $container;
}

// Create a function element
function makeFunctionElement(func) {
  dbg("makeFunctionElement", "Creating function element", func);
  const $item = $('<div>', {
    class: 'doc-function-item',
    'data-function': func.name
  });

  // Create header
  const $header = $('<div>', {
    class: 'doc-function-header'
  });

  // Add star button
  const $starButton = $('<button>', {
    class: 'doc-star-button',
    html: state.starredFunctions.has(func.name) ? '★' : '☆',
    title: state.starredFunctions.has(func.name) ? 'Remove from favorites' : 'Add to favorites'
  });

  $starButton.on('click', (e) => {
    e.stopPropagation();
    if (state.starredFunctions.has(func.name)) {
      state.starredFunctions.delete(func.name);
      $starButton.html('☆').attr('title', 'Add to favorites');
    } else {
      state.starredFunctions.add(func.name);
      $starButton.html('★').attr('title', 'Remove from favorites');
    }
    saveUserPreferences();
    renderFunctionList();
  });

  // Add function name
  const $name = $('<div>', {
    class: 'doc-function-name',
    text: func.name
  });

  // Add expand/collapse indicator
  const $expandIndicator = $('<span>', {
    class: 'doc-expand-indicator',
    text: state.expandedFunctions.has(func.name) ? '▼' : '▶'
  });

  $header.append($starButton, $name, $expandIndicator);

  // Create content container
  const $content = $('<div>', {
    class: 'doc-function-content',
    style: state.expandedFunctions.has(func.name) ? 'display: block' : 'display: none'
  });

  // Add description
  if (func.description) {
    const $description = $('<div>', {
      class: 'doc-function-description',
      html: marked.parse(func.description)
    });
    $content.append($description);
  }

  // Add code examples
  if (func.examples && func.examples.length > 0) {
    const $examplesContainer = $('<div>', {
      class: 'doc-function-examples'
    });

    func.examples.forEach((example, index) => {
      $examplesContainer.append(makeCodeEditor(example, `${func.name}-${index}`));
    });

    $content.append($examplesContainer);
  }

  // Add click handler for expand/collapse
  $item.on('click', (e) => {
    dbg("makeFunctionElement", "Function item clicked", func.name);
    if (!$(e.target).is('.doc-star-button')) {
      if (state.expandedFunctions.has(func.name)) {
        state.expandedFunctions.delete(func.name);
        $expandIndicator.text('▶');
        $content.hide();
      } else {
        state.expandedFunctions.add(func.name);
        $expandIndicator.text('▼');
        $content.show();
      }
      saveUserPreferences();
    }
  });

  $item.append($header, $content);
  return $item;
}

// Create the function list
function makeFunctionList(data, columns = 1) {
  dbg("makeFunctionList", "Creating function list", { data, columns });
  if (!data || !Array.isArray(data)) {
    console.error("Invalid data passed to makeFunctionList:", data);
    return $('<div>', {
      class: 'doc-error-message',
      text: 'Invalid documentation data'
    });
  }

  const $container = $('<div>', {
    id: 'doc-function-list',
    class: 'doc-function-list'
  });

  // Filter functions based on selected tags
  const filteredFunctions = data.filter(func => {
    if (!func || typeof func !== 'object') return false;
    if (state.selectedTags.size === 0) return true;
    return Array.from(state.selectedTags).every(tag => func.tags.includes(tag));
  });

  // Sort by starred status
  filteredFunctions.sort((a, b) => {
    const aStarred = state.starredFunctions.has(a.name);
    const bStarred = state.starredFunctions.has(b.name);
    if (aStarred === bStarred) return 0;
    return aStarred ? -1 : 1;
  });

  // Create grid container if multiple columns
  const $grid = columns > 1 ? $('<div>', { class: 'doc-function-grid' }) : null;
  const $target = $grid || $container;

  // Add functions to the list
  filteredFunctions.forEach(func => {
    dbg("makeFunctionList", "Adding function to list", func.name);
    if (!func || typeof func !== 'object') return;
    const $functionElement = makeFunctionElement(func);
    if ($functionElement && $functionElement.length) {
      $target.append($functionElement);
    }
  });

  // Add grid to container if using multiple columns
  if ($grid) {
    $container.append($grid);
  }

  // Show message if no functions match
  if (!filteredFunctions.length) {
    const $noResults = $('<div>', {
      class: 'doc-no-results',
      text: 'No functions match the selected tags'
    }).css({
      padding: '1em',
      textAlign: 'center',
      color: 'var(--text-muted, #666)'
    });
    $container.append($noResults);
  }

  return $container;
}


// Show documentation for a symbol
export function showDocumentationForSymbol(editor) {
  dbg("showDocumentationForSymbol", "Showing documentation for symbol");
  if (!editor) return false;

  const cursor = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(cursor);
  const lineText = line.text;

  let start = cursor - line.from;
  let end = start;

  while (start > 0 && /[\w-]/.test(lineText.charAt(start - 1))) {
    start--;
  }

  while (end < lineText.length && /[\w-]/.test(lineText.charAt(end))) {
    end++;
  }

  if (start < end) {
    const symbol = lineText.substring(start, end);
    dbg("showDocumentationForSymbol", "Symbol identified", symbol);

    const func = state.data.find(
      (f) => f.name === symbol || (f.aliases && f.aliases.includes(symbol))
    );

    if (func) {
      dbg("showDocumentationForSymbol", "Function found", func.name);
      $("#panel-help").show();
      $("#panel-help-tab-reference").click();
      state.expandedFunctions = new Set([func.name]);
      state.selectedTags.clear();
      $(".doc-tag").removeClass("selected");
      renderFunctionList();

      setTimeout(() => {
        const $functionItem = $(`.doc-function-item[data-function="${func.name}"]`);
        if ($functionItem.length) {
          $functionItem[0].scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 100);

      return true;
    }
  }

  dbg("showDocumentationForSymbol", "No matching function found");
  return false;
}

async function loadReferenceData() {
  dbg("loadReferenceData", "Fetching reference data");
  try {
    const response = await fetch("/modulisp_reference_data.json");
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    
    // Validate data structure
    if (!Array.isArray(data)) {
      throw new Error('Documentation data must be an array');
    }

    // Validate each function entry
    data.forEach(func => {
      if (!func || typeof func !== 'object') {
        throw new Error('Each function entry must be an object');
      }
      if (!func.name || typeof func.name !== 'string') {
        throw new Error('Each function must have a name property');
      }
      if (!Array.isArray(func.tags)) {
        throw new Error('Each function must have a tags array');
      }
    });

    dbg("loadReferenceData", "Reference data loaded successfully");
    return data;
  } catch (error) {
    dbg("loadReferenceData", "Error loading reference data", error);
    throw error;
  }
}

// Adjust documentation panel elements for theme
function adjustDocPanelForTheme() {
  dbg("adjustDocPanelForTheme", "Adjusting documentation panel for theme");
  const textColor = getComputedStyle(document.documentElement)
    .getPropertyValue("--text-primary")
    .trim();

  let isLightText = false;
  if (textColor.startsWith("#")) {
    const hex = textColor.substring(1);
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const brightness = r * 0.299 + g * 0.587 + b * 0.114;
    isLightText = brightness > 128;
  } else if (textColor.startsWith("rgb")) {
    const rgb = textColor.match(/\d+/g);
    if (rgb && rgb.length >= 3) {
      const r = parseInt(rgb[0]);
      const g = parseInt(rgb[1]);
      const b = parseInt(rgb[2]);
      const brightness = r * 0.299 + g * 0.587 + b * 0.114;
      isLightText = brightness > 128;
    }
  }

  const isLightTheme = !isLightText;

  if (isLightTheme) {
    $(".doc-tag").css({
      "background-color": "#f0f0f0",
      color: "#333",
    });

    $(".doc-tag.selected").css({
      "background-color": "var(--accent-color, #0066cc)",
      color: "white",
    });

    $(".doc-function-header").css({
      "background-color": "#f5f5f5",
      color: "#333",
    });

    $(".doc-function-details").css({
      "background-color": "#fafafa",
      color: "#333",
      "border-top": "1px solid #ddd",
    });

    $(".doc-section-title").css({
      color: "var(--accent-color, #0066cc)",
    });

    $(".doc-param-name").css({
      "background-color": "#f0f0f0",
      color: "#333",
      border: "1px solid #ddd",
    });

    $(".doc-function-tag").css({
      "background-color": "#f0f0f0",
      color: "#555",
    });

    $(".doc-example-editor .cm-editor").css({
      "background-color": "#f8f8f8",
      border: "1px solid #eee",
    });
  } else {
    $(".doc-tag").css({
      "background-color": "var(--panel-item-hover-bg)",
      color: "var(--text-primary)",
    });

    $(".doc-tag.selected").css({
      "background-color": "var(--accent-color)",
      color: "#000",
    });

    $(".doc-function-header").css({
      "background-color": "var(--panel-section-bg)",
      color: "var(--text-primary)",
    });

    $(".doc-function-details").css({
      "background-color": "var(--panel-control-bg)",
      color: "var(--text-primary)",
      "border-top": "1px solid var(--panel-border)",
    });

    $(".doc-section-title").css({
      color: "var(--accent-color)",
    });

    $(".doc-param-name").css({
      "background-color": "var(--panel-item-hover-bg)",
      color: "var(--text-primary)",
      border: "none",
    });

    $(".doc-function-tag").css({
      "background-color": "var(--panel-item-hover-bg)",
      color: "var(--text-primary)",
    });

    $(".doc-example-editor .cm-editor").css({
      "background-color": "",
      border: "",
    });
  }
}

function makeTags(data) {
  // Get all unique tags from the documentation data
  const allTags = new Set();
  data.forEach(func => {
    if (func && func.tags) {
      func.tags.forEach(tag => allTags.add(tag));
    }
  });

  // Create container
  const $container = $('<div>', {
    class: 'doc-tags-container'
  });

  const $wrapper = $('<div>', {
    class: 'doc-tags-wrapper'
  });

  // Sort tags alphabetically and create tag elements
  Array.from(allTags).sort().forEach(tag => {
    const $tag = $('<div>', {
      class: 'doc-tag',
      text: tag
    });

    if (state.selectedTags.has(tag)) {
      $tag.addClass('selected');
    }

    $tag.on('click', () => {
      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
        $tag.removeClass('selected');
      } else {
        state.selectedTags.add(tag);
        $tag.addClass('selected');
      }
      renderFunctionList();
    });

    $wrapper.append($tag);
  });

  $container.append($wrapper);
  return $container;
}

// Render the function list
function renderFunctionList() {
  dbg("renderFunctionList", "Rendering function list");
  if (!state.data || !Array.isArray(state.data)) {
    console.error("Cannot render function list: invalid data");
    return;
  }
  
  const $container = $('#panel-help-reference');
  if (!$container.length) {
    console.error("Cannot render function list: container not found");
    return;
  }

  const $oldList = $('#doc-function-list');
  if ($oldList.length) {
    $oldList.remove();
  }
  
  $container.append(makeFunctionList(state.data));
}
