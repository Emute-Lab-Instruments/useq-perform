import { dbg } from "../../utils.mjs";
import { createExampleEditor } from "../../editors/main.mjs";
import { marked } from "marked";
import { currentVersion as connectedFirmwareVersion } from "../../utils/upgradeCheck.mjs";

const STORAGE_KEYS = Object.freeze({
  starred: "moduLispReference:starredFunctions",
  expanded: "moduLispReference:expandedFunctions",
  version: "moduLispReference:targetVersion"
});

const state = {
  data: [],
  selectedTags: new Set(),
  starredFunctions: new Set(),
  expandedFunctions: new Set(),
  tags: [],
  functionIndex: new Map(),
  aliasIndex: new Map(),
  versionOptions: [],
  targetVersion: null,
  parsedTargetVersion: null
};

const ui = {
  root: null,
  versionSelect: null,
  clearTagsButton: null,
  tagsWrapper: null
};

const PANEL_ANIMATION_DURATION = 260;
const PANEL_EXPAND_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)'; // Fast start with smooth landing
// Alternate easings you can try:
// const PANEL_EXPAND_EASING = 'cubic-bezier(0.33, 1, 0.68, 1)'; // Ease-out quartic feel
// const PANEL_EXPAND_EASING = 'cubic-bezier(0.4, 0, 0.2, 1)'; // Balanced ease-in-out curve

function restoreSetFromStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) {
      return new Set();
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? new Set(parsed) : new Set();
  } catch (error) {
    dbg("moduLispReference", "Failed to restore set", key, error);
    return new Set();
  }
}

function persistSetToStorage(key, valueSet) {
  try {
    localStorage.setItem(key, JSON.stringify(Array.from(valueSet)));
  } catch (error) {
    dbg("moduLispReference", "Failed to persist set", key, error);
  }
}

function restoreTargetVersion() {
  try {
    return localStorage.getItem(STORAGE_KEYS.version);
  } catch (error) {
    dbg("moduLispReference", "Failed to restore target version", error);
    return null;
  }
}

function persistTargetVersion(version) {
  try {
    if (version) {
      localStorage.setItem(STORAGE_KEYS.version, version);
    } else {
      localStorage.removeItem(STORAGE_KEYS.version);
    }
  } catch (error) {
    dbg("moduLispReference", "Failed to persist target version", error);
  }
}

function animatePanelContent(element, expanding) {
  if (!element) {
    return;
  }

  const supportsAnimation = typeof element.animate === 'function';
  if (!supportsAnimation) {
    element.classList.toggle('doc-function-content--active', expanding);
    element.style.display = expanding ? 'block' : 'none';
    element.style.height = '';
    element.style.opacity = '';
    element.style.transform = '';
    element.style.overflow = '';
    return;
  }

  if (typeof element.getAnimations === 'function') {
    element.getAnimations().forEach((animation) => animation.cancel());
  }

  if (expanding) {
    element.classList.add('doc-function-content--active');
  }

  element.style.display = 'block';
  element.style.overflow = 'hidden';

  const targetHeight = element.scrollHeight || 0;
  const keyframes = expanding
    ? [
        { height: '0px', opacity: 0, transform: 'translateY(-4px)' },
        { height: `${targetHeight}px`, opacity: 1, transform: 'translateY(0)' }
      ]
    : [
        { height: `${targetHeight}px`, opacity: 1, transform: 'translateY(0)' },
        { height: '0px', opacity: 0, transform: 'translateY(-4px)' }
      ];

  const animation = element.animate(keyframes, {
    duration: PANEL_ANIMATION_DURATION,
    easing: PANEL_EXPAND_EASING,
    fill: 'both'
  });

  const cleanup = () => {
    if (!expanding) {
      element.classList.remove('doc-function-content--active');
      element.style.display = 'none';
    } else {
      element.style.display = 'block';
    }
    element.style.height = '';
    element.style.opacity = '';
    element.style.transform = '';
    element.style.overflow = '';
  };

  animation.onfinish = cleanup;
  animation.oncancel = cleanup;
}

function setContentVisibility($content, expanded, { animate = false } = {}) {
  if (!$content || !$content.length) {
    return;
  }

  const element = $content[0];
  if (animate) {
    animatePanelContent(element, expanded);
    return;
  }

  element.classList.toggle('doc-function-content--active', expanded);
  element.style.display = expanded ? 'block' : 'none';
  element.style.height = '';
  element.style.opacity = '';
  element.style.transform = '';
  element.style.overflow = '';
}

function setItemExpandedState($item, $content, $indicator, expanded, options = {}) {
  if ($item && $item.length) {
    $item.toggleClass('doc-function-item--expanded', expanded);
  }

  if ($indicator && $indicator.length) {
    $indicator.text(expanded ? '▼' : '▶');
  }

  setContentVisibility($content, expanded, options);
}

function ensureArray(value) {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.filter(Boolean);
  }
  return [value].filter(Boolean);
}

function getReferenceDataCandidateUrls() {
  const candidates = new Set();
  const relativeCandidates = [
    "../../assets/modulisp_reference_data.json",
    "../assets/modulisp_reference_data.json",
    "./assets/modulisp_reference_data.json"
  ];

  relativeCandidates.forEach((path) => {
    try {
      candidates.add(new URL(path, import.meta.url).href);
    } catch (error) {
      dbg("moduLispReference", "Failed to resolve data path via import.meta", { path, error });
    }
  });

  const windowHref = typeof window !== "undefined" ? window.location.href : null;
  if (windowHref) {
    [
      "assets/modulisp_reference_data.json",
      "/assets/modulisp_reference_data.json",
      "/dev/assets/modulisp_reference_data.json",
      "../assets/modulisp_reference_data.json"
    ].forEach((path) => {
      try {
        candidates.add(new URL(path, windowHref).href);
      } catch (error) {
        dbg("moduLispReference", "Failed to resolve data path via window", { path, error });
      }
    });
  }

  return Array.from(candidates);
}

function normalizeParameters(parameters) {
  if (!parameters) {
    return [];
  }

  if (Array.isArray(parameters)) {
    return parameters
      .filter(Boolean)
      .map((param) => {
        if (typeof param === "string") {
          return { name: param, description: "" };
        }
        if (typeof param === "object") {
          return {
            name: param.name || "",
            description: param.description || "",
            range: param.range || ""
          };
        }
        return null;
      })
      .filter(Boolean);
  }

  if (typeof parameters === "object") {
    return Object.entries(parameters).map(([name, description]) => ({
      name,
      description: typeof description === "string" ? description : ""
    }));
  }

  if (typeof parameters === "string") {
    return [{ name: parameters, description: "" }];
  }

  return [];
}

function parseVersionString(version) {
  if (!version || typeof version !== "string") {
    return null;
  }

  const trimmed = version.trim().replace(/^v/i, "");
  if (!trimmed) {
    return null;
  }

  const [majorStr, minorStr = "0", patchStr = "0"] = trimmed.split(".");
  const major = Number.parseInt(majorStr, 10);
  const minor = Number.parseInt(minorStr, 10);
  const patch = Number.parseInt(patchStr, 10);

  if (Number.isNaN(major) || Number.isNaN(minor)) {
    return null;
  }

  return {
    major,
    minor,
    patch: Number.isNaN(patch) ? 0 : patch,
    raw: `${major}.${minor}.${Number.isNaN(patch) ? 0 : patch}`
  };
}

function compareVersions(left, right) {
  if (!left && !right) {
    return 0;
  }
  if (!left) {
    return -1;
  }
  if (!right) {
    return 1;
  }

  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  return left.patch - right.patch;
}

function normalizeEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") {
    return null;
  }

  const normalized = {
    ...rawEntry,
    name: typeof rawEntry.name === "string" ? rawEntry.name : "",
    aliases: ensureArray(rawEntry.aliases),
    tags: ensureArray(rawEntry.tags),
    parameters: normalizeParameters(rawEntry.parameters),
    examples: ensureArray(rawEntry.examples),
    meta: {
      introduced: parseVersionString(rawEntry.introduced_in_version),
      changed: parseVersionString(rawEntry.changed_in_version)
    }
  };

  return normalized;
}

function rebuildIndexes(data) {
  state.functionIndex = new Map();
  state.aliasIndex = new Map();

  data.forEach((func) => {
    state.functionIndex.set(func.name, func);
    func.aliases.forEach((alias) => {
      if (!state.aliasIndex.has(alias)) {
        state.aliasIndex.set(alias, func.name);
      }
    });
  });
}

function deriveTags(data) {
  const tagSet = new Set();
  data.forEach((func) => {
    func.tags.forEach((tag) => tagSet.add(tag));
  });
  state.tags = Array.from(tagSet).sort((a, b) => a.localeCompare(b));
}

function getConnectedVersionString() {
  if (connectedFirmwareVersion && connectedFirmwareVersion.string) {
    return connectedFirmwareVersion.string;
  }
  return null;
}

function deriveVersionOptions(data) {
  const versionMap = new Map();

  data.forEach((func) => {
    if (func.meta.introduced) {
      versionMap.set(func.meta.introduced.raw, func.meta.introduced);
    }
    if (func.meta.changed) {
      versionMap.set(func.meta.changed.raw, func.meta.changed);
    }
  });

  const stored = parseVersionString(state.targetVersion);
  if (stored) {
    versionMap.set(stored.raw, stored);
  }

  const connected = parseVersionString(getConnectedVersionString());
  if (connected) {
    versionMap.set(connected.raw, connected);
  }

  state.versionOptions = Array.from(versionMap.values()).sort((a, b) => compareVersions(b, a));
}

function resolveInitialTargetVersion() {
  const stored = parseVersionString(state.targetVersion);
  if (stored) {
    state.targetVersion = stored.raw;
    state.parsedTargetVersion = stored;
    return;
  }

  const connected = parseVersionString(getConnectedVersionString());
  if (connected) {
    state.targetVersion = connected.raw;
    state.parsedTargetVersion = connected;
    return;
  }

  state.targetVersion = null;
  state.parsedTargetVersion = null;
}

function initializeState(data) {
  state.data = data;
  rebuildIndexes(data);
  deriveTags(data);
  deriveVersionOptions(data);
  resolveInitialTargetVersion();
}

function populateVersionSelect() {
  if (!ui.versionSelect) {
    return;
  }

  const previousValue = state.targetVersion || "";
  ui.versionSelect.empty();

  ui.versionSelect.append(
    $('<option>', {
      value: '',
      text: 'Show all firmware versions'
    })
  );

  state.versionOptions.forEach((version) => {
    const connected = getConnectedVersionString();
    let label = `v${version.raw}`;
    if (connected && version.raw === connected) {
      label += ' (connected)';
    }
    ui.versionSelect.append(
      $('<option>', {
        value: version.raw,
        text: label
      })
    );
  });

  if (previousValue) {
    if (!state.versionOptions.some((version) => version.raw === previousValue)) {
      ui.versionSelect.append(
        $('<option>', {
          value: previousValue,
          text: `v${previousValue}`
        })
      );
    }
    ui.versionSelect.val(previousValue);
  } else {
    ui.versionSelect.val('');
  }
}

function updateClearTagsButton() {
  if (!ui.clearTagsButton) {
    return;
  }
  ui.clearTagsButton.prop('disabled', state.selectedTags.size === 0);
}

function handleVersionChange(value) {
  const normalized = parseVersionString(value);
  state.targetVersion = normalized ? normalized.raw : null;
  state.parsedTargetVersion = normalized;
  persistTargetVersion(state.targetVersion);
  renderFunctionList();
}

function toggleFunctionExpansion(functionName, expanded, $item, $content, $indicator) {
  if (expanded) {
    state.expandedFunctions.add(functionName);
  } else {
    state.expandedFunctions.delete(functionName);
  }

  setItemExpandedState($item, $content, $indicator, expanded, { animate: true });
  persistSetToStorage(STORAGE_KEYS.expanded, state.expandedFunctions);
}

function toggleStar(functionName) {
  if (state.starredFunctions.has(functionName)) {
    state.starredFunctions.delete(functionName);
  } else {
    state.starredFunctions.add(functionName);
  }
  persistSetToStorage(STORAGE_KEYS.starred, state.starredFunctions);
  renderFunctionList();
}

function isFunctionAvailable(func) {
  if (!state.parsedTargetVersion) {
    return true;
  }

  const introduced = func.meta?.introduced;
  if (!introduced) {
    return true;
  }

  return compareVersions(state.parsedTargetVersion, introduced) >= 0;
}

function hasUpcomingChange(func) {
  if (!state.parsedTargetVersion || !func.meta?.changed) {
    return false;
  }
  return compareVersions(state.parsedTargetVersion, func.meta.changed) < 0;
}

function createVersionBadge(func, available) {
  if (!func.meta?.introduced) {
    return null;
  }
  const label = available ? `Since v${func.meta.introduced.raw}` : `Requires v${func.meta.introduced.raw}`;
  return $('<span>', {
    class: 'doc-function-version-chip',
    text: label
  });
}

function createAvailabilityBanner(func, available) {
  if (available) {
    return null;
  }
  return $('<div>', {
    class: 'doc-function-availability-note',
    text: `Available from firmware v${func.meta?.introduced?.raw || ''}`.trim()
  });
}

function createChangeNote(func) {
  if (!func.meta?.changed) {
    return null;
  }

  const upcoming = hasUpcomingChange(func);
  const text = upcoming ? `Changes coming in v${func.meta.changed.raw}` : `Updated in v${func.meta.changed.raw}`;

  return $('<div>', {
    class: `doc-function-change-note${upcoming ? ' doc-function-change-note--upcoming' : ''}`,
    text
  });
}

function buildParametersSection(func) {
  if (!func.parameters.length) {
    return null;
  }

  const $title = $('<div>', { class: 'doc-section-title', text: 'Parameters' });
  const $list = $('<ul>', { class: 'doc-params-list' });

  func.parameters.forEach((param) => {
    const $item = $('<li>', { class: 'doc-param-item' });
    $item.append(
      $('<span>', { class: 'doc-param-name', text: param.name || 'unnamed' })
    );
    if (param.description) {
      $item.append(' ', $('<span>', { class: 'doc-param-description', text: param.description }));
    }
    if (param.range) {
      $item.append(
        $('<div>', {
          class: 'doc-param-range',
          text: `Range: ${param.range}`
        })
      );
    }
    $list.append($item);
  });

  return $('<div>').append($title, $list);
}

function buildExamplesSection(func) {
  if (!func.examples.length) {
    return null;
  }

  const $title = $('<div>', { class: 'doc-section-title', text: 'Examples' });
  const $list = $('<div>', { class: 'doc-examples-list' });

  func.examples.forEach((example) => {
    const $wrapper = $('<div>', { class: 'doc-example-wrapper' });
    const $pre = $('<pre>', {
      class: 'doc-example-simple',
      text: example
    });
    const $button = $('<button>', {
      class: 'doc-copy-button',
      text: 'Copy',
      title: 'Copy example to clipboard'
    });

    $button.on('click', (event) => {
      event.stopPropagation();
      navigator.clipboard.writeText(example).then(() => {
        $button.text('Copied!').addClass('copied');
        setTimeout(() => {
          $button.text('Copy').removeClass('copied');
        }, 2000);
      }).catch((error) => {
        console.error('Could not copy text:', error);
      });
    });

    $wrapper.append($pre, $button);
    $list.append($wrapper);
  });

  return $('<div>').append($title, $list);
}

function buildTagsSection(func) {
  if (!func.tags.length) {
    return null;
  }

  const $title = $('<div>', { class: 'doc-section-title', text: 'Tags' });
  const $tags = $('<div>', { class: 'doc-function-tags' });
  func.tags.forEach((tag) => {
    $tags.append($('<span>', { class: 'doc-function-tag', text: tag }));
  });
  return $('<div>').append($title, $tags);
}

function buildFunctionElement(func) {
  const available = isFunctionAvailable(func);
  const $item = $('<div>', {
    class: `doc-function-item${available ? '' : ' doc-function-item--unavailable'}`,
    'data-function': func.name
  });

  const $header = $('<div>', { class: 'doc-function-header' });
  const $name = $('<div>', { class: 'doc-function-name', text: func.name });

  if (func.parameters.length) {
    const $paramsContainer = $('<span>', { class: 'doc-function-params-container' });
    func.parameters.forEach((param) => {
      $paramsContainer.append(
        $('<span>', { class: 'doc-function-param', html: `&lt;${param.name}&gt;` })
      );
    });
    $name.append(' ', $paramsContainer);
  }

  const $badge = createVersionBadge(func, available);
  const $starButton = $('<button>', {
    class: 'doc-star-button',
    html: state.starredFunctions.has(func.name) ? '★' : '☆',
    title: state.starredFunctions.has(func.name) ? 'Remove from favorites' : 'Add to favorites'
  });

  const isExpanded = state.expandedFunctions.has(func.name);
  const $indicator = $('<span>', { class: 'doc-expand-indicator' });

  const $content = $('<div>', {
    class: 'doc-function-content'
  });

  if (func.description) {
    $content.append(
      $('<div>', {
        class: 'doc-function-description',
        html: marked.parse(func.description)
      })
    );
  }

  const $banner = createAvailabilityBanner(func, available);
  if ($banner) {
    $content.prepend($banner);
  }

  const $changeNote = createChangeNote(func);
  if ($changeNote) {
    $content.append($changeNote);
  }

  const $params = buildParametersSection(func);
  if ($params) {
    $content.append($params.children());
  }

  const $examples = buildExamplesSection(func);
  if ($examples) {
    $content.append($examples.children());
  }

  const $tags = buildTagsSection(func);
  if ($tags) {
    $content.append($tags.children());
  }

  $starButton.on('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    toggleStar(func.name);
  });

  $header.on('click', (event) => {
    if ($(event.target).is('.doc-star-button') || $(event.target).is('.doc-copy-button')) {
      return;
    }
    const nextExpandedState = !state.expandedFunctions.has(func.name);
    toggleFunctionExpansion(func.name, nextExpandedState, $item, $content, $indicator);
  });

  $header.append($name);
  if ($badge) {
    $header.append($badge);
  }
  $header.append($starButton, $indicator);

  $item.append($header, $content);
  setItemExpandedState($item, $content, $indicator, isExpanded, { animate: false });
  return $item;
}

function getFilteredFunctions() {
  if (!Array.isArray(state.data)) {
    return [];
  }

  const selectedTags = state.selectedTags;
  const filtered = state.data.filter((func) => {
    if (!selectedTags.size) {
      return true;
    }
    if (!func.tags.length) {
      return false;
    }
    return func.tags.some((tag) => selectedTags.has(tag));
  });

  filtered.sort((left, right) => {
    const leftStar = state.starredFunctions.has(left.name) ? 0 : 1;
    const rightStar = state.starredFunctions.has(right.name) ? 0 : 1;
    if (leftStar !== rightStar) {
      return leftStar - rightStar;
    }

    const leftAvailable = isFunctionAvailable(left) ? 0 : 1;
    const rightAvailable = isFunctionAvailable(right) ? 0 : 1;
    if (leftAvailable !== rightAvailable) {
      return leftAvailable - rightAvailable;
    }

    return left.name.localeCompare(right.name);
  });

  return filtered;
}

function renderFunctionList() {
  if (!ui.root) {
    return;
  }

  const existing = ui.root.find('#doc-function-list');
  if (existing.length) {
    existing.remove();
  }

  const functions = getFilteredFunctions();
  const $list = $('<div>', {
    id: 'doc-function-list',
    class: 'doc-function-list'
  });

  functions.forEach((func) => {
    $list.append(buildFunctionElement(func));
  });

  if (!functions.length) {
    $list.append(
      $('<div>', {
        class: 'doc-no-results',
        text: 'No functions match the current filters.'
      })
    );
  }

  populateVersionSelect();
  updateClearTagsButton();

  ui.root.append($list);
  initializeCodeMirrorEditors();
}

function buildTagsPanel() {
  const $container = $('<div>', { class: 'doc-tags-container' });
  const $controls = $('<div>', { class: 'doc-filters-controls' });

  const $versionLabel = $('<label>', {
    class: 'doc-filter-label',
    for: 'modulisp-version-filter',
    text: 'Firmware version'
  });

  const $versionSelect = $('<select>', {
    id: 'modulisp-version-filter',
    class: 'doc-version-select'
  });

  $versionSelect.on('change', () => {
    handleVersionChange($versionSelect.val());
  });

  ui.versionSelect = $versionSelect;

  const $versionWrapper = $('<div>', { class: 'doc-version-filter' });
  $versionWrapper.append($versionLabel, $versionSelect);

  const $clearTagsButton = $('<button>', {
    class: 'doc-clear-tags',
    text: 'Clear tags'
  });

  $clearTagsButton.on('click', () => {
    state.selectedTags.clear();
    ui.tagsWrapper.find('.doc-tag').removeClass('selected');
    updateClearTagsButton();
    renderFunctionList();
  });

  ui.clearTagsButton = $clearTagsButton;

  $controls.append($versionWrapper, $clearTagsButton);

  const $wrapper = $('<div>', { class: 'doc-tags-wrapper' });
  ui.tagsWrapper = $wrapper;

  state.tags.forEach((tag) => {
    const $tag = $('<div>', {
      class: `doc-tag${state.selectedTags.has(tag) ? ' selected' : ''}`,
      text: tag
    });

    $tag.on('click', () => {
      if (state.selectedTags.has(tag)) {
        state.selectedTags.delete(tag);
        $tag.removeClass('selected');
      } else {
        state.selectedTags.add(tag);
        $tag.addClass('selected');
      }
      updateClearTagsButton();
      renderFunctionList();
    });

    $wrapper.append($tag);
  });

  updateClearTagsButton();
  populateVersionSelect();

  $container.append($controls, $wrapper);
  return $container;
}

function initializeCodeMirrorEditors() {
  const codeBlocks = document.querySelectorAll('.doc-example-simple');
  codeBlocks.forEach((block) => {
    const code = block.textContent.trim();
    const container = document.createElement('div');
    block.replaceWith(container);
    createExampleEditor(code, container);
  });
}

async function loadReferenceData() {
  const candidates = getReferenceDataCandidateUrls();
  dbg('loadReferenceData', 'Attempting to fetch reference data', candidates);

  const errors = [];
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { cache: 'no-store' });
      if (!response.ok) {
        errors.push(`${candidate} -> ${response.status}`);
        continue;
      }
      const data = await response.json();
      if (!Array.isArray(data)) {
        errors.push(`${candidate} -> invalid payload`);
        continue;
      }
      dbg('loadReferenceData', 'Loaded reference data from', candidate);
      return data;
    } catch (error) {
      errors.push(`${candidate} -> ${error.message}`);
    }
  }

  throw new Error(`Unable to load documentation data (${errors.join('; ')})`);
}

export async function makeModuLispReference() {
  dbg('makeModuLispReference', 'Initializing ModuLisp reference panel');

  state.starredFunctions = restoreSetFromStorage(STORAGE_KEYS.starred);
  state.expandedFunctions = restoreSetFromStorage(STORAGE_KEYS.expanded);
  state.targetVersion = restoreTargetVersion();

  const $container = $('<div>', {
    class: 'modulisp-reference-container'
  });

  ui.root = $container;

  try {
    const rawData = await loadReferenceData();
    const normalizedData = rawData.map(normalizeEntry).filter(Boolean);

    initializeState(normalizedData);

    const $filters = buildTagsPanel();
    $container.append($filters);
    renderFunctionList();

    return $container;
  } catch (error) {
    dbg('makeModuLispReference', 'Error creating reference panel', error);
    console.error('Error creating reference panel:', error);

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

export function showDocumentationForSymbol(editor) {
  dbg('showDocumentationForSymbol', 'Showing documentation for symbol');
  if (!editor || !state.data.length) {
    return false;
  }

  const cursor = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(cursor);
  const lineText = line.text;

  let start = cursor - line.from;
  let end = start;

  while (start > 0 && /[\w-]/.test(lineText.charAt(start - 1))) {
    start -= 1;
  }

  while (end < lineText.length && /[\w-]/.test(lineText.charAt(end))) {
    end += 1;
  }

  if (start >= end) {
    return false;
  }

  const symbol = lineText.substring(start, end);
  const directMatch = state.functionIndex.get(symbol);
  const aliasTarget = state.aliasIndex.get(symbol);
  const func = directMatch || (aliasTarget ? state.functionIndex.get(aliasTarget) : null);

  if (!func) {
    return false;
  }

  $('#panel-help').show();
  $('#panel-help-tab-reference').click();

  state.expandedFunctions.add(func.name);
  persistSetToStorage(STORAGE_KEYS.expanded, state.expandedFunctions);
  state.selectedTags.clear();
  if (ui.tagsWrapper) {
    ui.tagsWrapper.find('.doc-tag').removeClass('selected');
  }
  updateClearTagsButton();
  renderFunctionList();

  setTimeout(() => {
    const $item = $(`.doc-function-item[data-function="${func.name}"]`);
    if ($item.length) {
      $item[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 100);

  return true;
}
