import { getCurrentBarValue } from "./serialVis/visualisationController.mjs";

const UPDATE_INTERVAL_MS = 1000 / 30; // ~30 FPS
const CONTAINER_ID = 'toolbar-bar-progress-container';
const BAR_ID = 'toolbar-bar-progress';

let intervalHandle = null;
let barElement = null;
let containerElement = null;
let resizeObserver = null;
let resizeListener = null;

function clamp01(value) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (value < 0) {
    return 0;
  }
  if (value > 1) {
    return 1;
  }
  return value;
}

function updateProgressBar() {
  if (!barElement) {
    return;
  }
  const value = clamp01(getCurrentBarValue());
  barElement.style.transform = `scaleX(${value})`;
}

function calculateRowWidth(row) {
  if (!row) {
    return 0;
  }
  const { width } = row.getBoundingClientRect();
  return width || 0;
}

function applyContainerWidth(width) {
  if (!containerElement) {
    return;
  }
  if (width > 0) {
    containerElement.style.width = `${width}px`;
    containerElement.style.marginLeft = 'auto';
    containerElement.style.marginRight = 'auto';
    containerElement.style.display = 'block';
    return;
  }
  containerElement.style.width = '100%';
  containerElement.style.marginLeft = '';
  containerElement.style.marginRight = '';
}

function stopObservingRowWidth() {
  if (resizeObserver) {
    resizeObserver.disconnect();
    resizeObserver = null;
  }
  if (resizeListener) {
    window.removeEventListener('resize', resizeListener);
    resizeListener = null;
  }
}

function observeRowWidth(row) {
  stopObservingRowWidth();
  if (!row) {
    return;
  }
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        applyContainerWidth(entry.contentRect.width);
      });
    });
    resizeObserver.observe(row);
    return;
  }
  resizeListener = () => {
    applyContainerWidth(calculateRowWidth(row));
  };
  window.addEventListener('resize', resizeListener, { passive: true });
}

function startUpdates() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
  }
  intervalHandle = setInterval(updateProgressBar, UPDATE_INTERVAL_MS);
  updateProgressBar();
}

function resolveToolbarRoot(toolbarRow) {
  const explicit = document.getElementById('panel-top-toolbar');
  if (explicit) {
    return explicit;
  }
  if (toolbarRow && toolbarRow.parentElement) {
    return toolbarRow.parentElement;
  }
  return toolbarRow || null;
}

function findReferenceRow(toolbarRow, parent) {
  if (toolbarRow) {
    return toolbarRow;
  }
  if (parent) {
    const firstRow = parent.querySelector('.toolbar-row');
    if (firstRow) {
      return firstRow;
    }
  }
  return null;
}

function syncContainerWidth(toolbarRow) {
  const parent = resolveToolbarRoot(toolbarRow);
  const referenceRow = findReferenceRow(toolbarRow, parent);
  applyContainerWidth(calculateRowWidth(referenceRow));
  observeRowWidth(referenceRow);
}

function ensurePosition(container, toolbarRow) {
  const parent = resolveToolbarRoot(toolbarRow);
  if (!parent) {
    return;
  }

  if (toolbarRow && toolbarRow.nextSibling) {
    parent.insertBefore(container, toolbarRow.nextSibling);
  } else if (toolbarRow && toolbarRow.parentElement === parent) {
    parent.appendChild(container);
  } else {
    parent.appendChild(container);
  }
}

export function initToolbarBarProgress(toolbarRow) {
  const parent = resolveToolbarRoot(toolbarRow);
  if (!parent) {
    return;
  }

  const existing = document.getElementById(CONTAINER_ID);
  if (existing) {
    containerElement = existing;
    barElement = existing.querySelector(`#${BAR_ID}`);
    ensurePosition(existing, toolbarRow);
    existing.style.display = 'block';
    syncContainerWidth(toolbarRow);
    startUpdates();
    return;
  }

  const container = document.createElement('div');
  container.id = CONTAINER_ID;
  container.style.pointerEvents = 'none';
  container.setAttribute('role', 'presentation');

  barElement = document.createElement('div');
  barElement.id = BAR_ID;
  barElement.style.pointerEvents = 'none';
  container.appendChild(barElement);

  ensurePosition(container, toolbarRow);
  containerElement = container;
  syncContainerWidth(toolbarRow);
  startUpdates();
}

export function disposeToolbarBarProgress() {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
  stopObservingRowWidth();
  barElement = null;
  containerElement = null;
}
