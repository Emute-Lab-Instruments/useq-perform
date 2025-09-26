import { dbg } from "../../utils.mjs";
import { activeUserSettings } from "../../utils/persistentUserSettings.mjs";
import { evalInUseqWasm, updateUseqWasmTime, evalOutputAtTime } from "../../io/useqWasmInterpreter.mjs";

const registeredExpressions = new Map();
const expressionColors = new Map();
let currentTimeSeconds = 0;
let currentBarValue = 0;
let settingsCache = null;
let colorCursor = 0;
let pendingRegistration = new Map();

const FALLBACK_PALETTE = ['#00ff41', '#1adbdb', '#ffaa00', '#ff0080', '#ff5500', '#ffee33', '#0088ff', '#aa00ff'];

function getDefaults() {
  return {
    offsetSeconds: 5,
    sampleCount: 100,
    lineWidth: 1.5,
    futureDashed: true,
    futureMaskOpacity: 0.35,
    futureMaskWidth: 12,
  };
}

function clampSettings(raw) {
  const defaults = getDefaults();
  const safe = { ...defaults, ...(raw || {}) };
  safe.offsetSeconds = Math.min(10, Math.max(0.5, Number(safe.offsetSeconds) || defaults.offsetSeconds));
  safe.sampleCount = Math.max(2, Math.min(400, Math.floor(Number(safe.sampleCount) || defaults.sampleCount)));
  safe.lineWidth = Math.min(5, Math.max(0.5, Number(safe.lineWidth) || defaults.lineWidth));
  safe.futureDashed = safe.futureDashed !== false;
  const opacity = Number(safe.futureMaskOpacity);
  safe.futureMaskOpacity = Number.isFinite(opacity) ? Math.min(1, Math.max(0, opacity)) : defaults.futureMaskOpacity;
  safe.futureMaskWidth = Math.min(48, Math.max(4, Number(safe.futureMaskWidth) || defaults.futureMaskWidth));
  return safe;
}

function loadSettings() {
  const visual = activeUserSettings.visualisation;
  settingsCache = clampSettings(visual);
  return settingsCache;
}

function getSettings() {
  if (!settingsCache) {
    return loadSettings();
  }
  return settingsCache;
}

function stepSize(settings) {
  const { offsetSeconds, sampleCount } = settings;
  if (sampleCount <= 1) {
    return offsetSeconds * 2;
  }
  return (offsetSeconds * 2) / (sampleCount - 1);
}

function notifyStateChanged(kind = "change") {
  try {
    window.dispatchEvent(
      new CustomEvent('useq-visualisation-changed', {
        detail: {
          kind,
          currentTimeSeconds,
          settings: getSettings(),
          expressions: registeredExpressions,
          bar: currentBarValue,
        }
      })
    );
  } catch (error) {
    dbg(`visualisationController: failed to dispatch change event: ${error}`);
  }
}

function nextColorIndex() {
  const idx = colorCursor % FALLBACK_PALETTE.length;
  colorCursor += 1;
  return idx;
}

function resolveColor(exprType) {
  if (expressionColors.has(exprType)) {
    return expressionColors.get(exprType);
  }

  const digit = Number.parseInt(exprType?.slice(1), 10);
  const index = Number.isFinite(digit)
    ? (digit - 1 + FALLBACK_PALETTE.length) % FALLBACK_PALETTE.length
    : nextColorIndex();
  const color = FALLBACK_PALETTE[index];
  expressionColors.set(exprType, color);
  return color;
}

export function reportExpressionColor(exprType, color) {
  if (!exprType || !color) {
    return;
  }
  expressionColors.set(exprType, color);
  const entry = registeredExpressions.get(exprType);
  if (entry) {
    entry.color = color;
  }
}

function resetSamples(expression, settings) {
  expression.samples = [];
  expression.nextSampleTime = currentTimeSeconds - settings.offsetSeconds;
}

async function sampleExpressionAt(expression, targetTime) {
  const value = await evalOutputAtTime(expression.exprType, targetTime);
  expression.samples.push({ time: targetTime, value });
}

async function initialiseSamples(expression, settings) {
  resetSamples(expression, settings);
  const { offsetSeconds, sampleCount } = settings;
  const step = stepSize(settings);
  const start = currentTimeSeconds - offsetSeconds;
  for (let i = 0; i < sampleCount; i += 1) {
    const sampleTime = start + (step * i);
    await sampleExpressionAt(expression, sampleTime);
  }
  expression.nextSampleTime = start + step * sampleCount;
}

async function ensureRegistered(exprType, expressionText, settings) {
  const existing = registeredExpressions.get(exprType);
  if (existing) {
    existing.expressionText = expressionText;
    existing.color = resolveColor(exprType);
    await initialiseSamples(existing, settings);
    return existing;
  }

  const entry = {
    exprType,
    expressionText,
    samples: [],
    color: resolveColor(exprType),
    nextSampleTime: 0,
  };
  registeredExpressions.set(exprType, entry);
  await initialiseSamples(entry, settings);
  return entry;
}

export async function refreshVisualisedExpression(exprType, expressionText) {
  const entry = registeredExpressions.get(exprType);
  if (!entry) {
    return;
  }

  const trimmed = (expressionText || '').trim();
  if (entry.expressionText === trimmed) {
    return;
  }

  entry.expressionText = trimmed;

  try {
    await evalInUseqWasm(trimmed);
  } catch (error) {
    dbg(`visualisationController: failed to update interpreter for ${exprType}: ${error}`);
  }

  const settings = getSettings();
  const step = stepSize(settings);
  const start = currentTimeSeconds;
  const end = currentTimeSeconds + settings.offsetSeconds;

  const pastSamples = entry.samples.filter((sample) => sample.time < start - 1e-9);
  entry.samples = pastSamples;

  for (let time = start; time <= end + 1e-9; time += step) {
    try {
      const value = await evalOutputAtTime(exprType, time);
      entry.samples.push({ time, value });
    } catch (error) {
      dbg(`visualisationController: sampling error for ${exprType} at ${time}: ${error}`);
      break;
    }
  }

  entry.nextSampleTime = end + step;
  entry.samples.sort((a, b) => a.time - b.time);
  notifyStateChanged('update');
}

export function isExpressionVisualised(exprType) {
  return registeredExpressions.has(exprType);
}

export function getVisualisationState() {
  return {
    currentTime: currentTimeSeconds,
    settings: getSettings(),
    expressions: registeredExpressions,
    bar: currentBarValue,
  };
}

export function getCurrentBarValue() {
  return currentBarValue;
}

export function getVisualisedExpressionTypes() {
  return Array.from(registeredExpressions.keys());
}

export function getVisualisedExpressionText(exprType) {
  return registeredExpressions.get(exprType)?.expressionText ?? null;
}

export async function registerVisualisation(exprType, expressionText) {
  const settings = getSettings();
  const key = exprType;
  if (pendingRegistration.has(key)) {
    return pendingRegistration.get(key);
  }

  const task = (async () => {
    const trimmed = (expressionText || '').trim();
    if (!trimmed) {
      if (registeredExpressions.delete(exprType)) {
        notifyStateChanged('unregister');
      }
      return;
    }
    await evalInUseqWasm(trimmed);
    await ensureRegistered(exprType, trimmed, settings);
    notifyStateChanged('register');
  })()
    .catch((error) => {
      dbg(`visualisationController: failed to register ${exprType}: ${error}`);
      registeredExpressions.delete(exprType);
      throw error;
    })
    .finally(() => {
      pendingRegistration.delete(key);
    });

  pendingRegistration.set(key, task);
  return task;
}

export function unregisterVisualisation(exprType) {
  if (registeredExpressions.delete(exprType)) {
    notifyStateChanged('unregister');
  }
}

export async function toggleVisualisation(exprType, expressionText) {
  if (isExpressionVisualised(exprType)) {
    unregisterVisualisation(exprType);
    return;
  }
  await registerVisualisation(exprType, expressionText);
}

function pruneSamples(expression, minTime) {
  expression.samples = expression.samples.filter((sample) => sample.time >= minTime);
}

async function advanceExpressionSamples(expression, settings, maxTime) {
  const step = stepSize(settings);
  if (step <= 0) {
    expression.samples = [];
    await sampleExpressionAt(expression, maxTime);
    expression.nextSampleTime = maxTime + step;
    return;
  }

  let nextTime = Math.max(expression.nextSampleTime ?? maxTime, maxTime - settings.offsetSeconds);
  // Ensure we always progress forward
  if (expression.samples.length > 0) {
    const lastSampleTime = expression.samples[expression.samples.length - 1].time;
    nextTime = Math.max(nextTime, lastSampleTime + step);
  }

  while (nextTime <= maxTime + 1e-9) {
    await sampleExpressionAt(expression, nextTime);
    nextTime += step;
  }

  expression.nextSampleTime = nextTime;
}

export async function handleExternalTimeUpdate(timeSeconds) {
  const numericTime = Number(timeSeconds) || 0;
  currentTimeSeconds = numericTime;

  try {
    await updateUseqWasmTime(numericTime);
  } catch (error) {
    dbg(`visualisationController: failed to update interpreter time: ${error}`);
    return;
  }

  await refreshBarValue();

  if (registeredExpressions.size === 0) {
    notifyStateChanged('time');
    return;
  }

  const settings = getSettings();
  const minTime = numericTime - settings.offsetSeconds;
  const maxTime = numericTime + settings.offsetSeconds;

  for (const expression of registeredExpressions.values()) {
    pruneSamples(expression, minTime - stepSize(settings));
    try {
      await advanceExpressionSamples(expression, settings, maxTime);
    } catch (error) {
      dbg(`visualisationController: sampling error for ${expression.exprType}: ${error}`);
    }
  }

  notifyStateChanged('data');
}

async function refreshBarValue() {
  try {
    const result = await evalInUseqWasm("bar");
    const numeric = Number.parseFloat(String(result).trim());
    if (Number.isFinite(numeric)) {
      const wrapped = numeric % 1;
      currentBarValue = wrapped < 0 ? wrapped + 1 : wrapped;
      return;
    }
  } catch (error) {
    dbg(`visualisationController: failed to read bar value: ${error}`);
  }
  currentBarValue = 0;
}

window.addEventListener('useq-settings-changed', () => {
  const settings = loadSettings();
  const reinitialise = async () => {
    for (const expression of registeredExpressions.values()) {
      await initialiseSamples(expression, settings);
    }
    notifyStateChanged('settings');
  };

  reinitialise().catch((error) => {
    dbg(`visualisationController: failed to refresh after settings change: ${error}`);
  });
});

loadSettings();
