import { dbg } from "../../utils.mjs";
import { activeUserSettings } from "../../utils/persistentUserSettings.mjs";
import { evalInUseqWasm, updateUseqWasmTime, evalOutputAtTime } from "../../io/useqWasmInterpreter.mjs";
import { getSerialVisPalette, getSerialVisChannelColor } from "./utils.mjs";

const registeredExpressions = new Map();
const expressionColors = new Map();
let currentTimeSeconds = 0;
let currentBarValue = 0;
let settingsCache = null;
let pendingRegistration = new Map();
let displayTimeSeconds = 0;
let lastDisplayUpdateMs = null;

const DEFAULT_FUTURE_LEAD_SECONDS = 1;
const MAX_FUTURE_LEAD_SECONDS = 8;
const DISPLAY_RATE_SECONDS_PER_SECOND = 1;
const SAMPLE_EPSILON = 1e-9;

function getDefaults() {
  return {
    offsetSeconds: 5,
    sampleCount: 100,
    lineWidth: 1.5,
    futureDashed: true,
    futureMaskOpacity: 0.35,
    futureMaskWidth: 12,
    circularOffset: 0,
    futureLeadSeconds: DEFAULT_FUTURE_LEAD_SECONDS,
    digitalLaneGap: 4,
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
  const circularOffsetNumeric = Number(safe.circularOffset);
  safe.circularOffset = Number.isFinite(circularOffsetNumeric)
    ? Math.round(circularOffsetNumeric)
    : defaults.circularOffset;
  const leadNumeric = Number(safe.futureLeadSeconds);
  safe.futureLeadSeconds = Number.isFinite(leadNumeric)
    ? Math.min(MAX_FUTURE_LEAD_SECONDS, Math.max(0, leadNumeric))
    : DEFAULT_FUTURE_LEAD_SECONDS;
  const digitalGapNumeric = Number(safe.digitalLaneGap);
  safe.digitalLaneGap = Number.isFinite(digitalGapNumeric)
    ? Math.min(40, Math.max(0, digitalGapNumeric))
    : defaults.digitalLaneGap;
  return safe;
}

function performanceNow() {
  if (typeof window !== 'undefined' && window.performance && typeof window.performance.now === 'function') {
    return window.performance.now();
  }
  return Date.now();
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) {
    return min;
  }
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function resetDisplayClock() {
  displayTimeSeconds = currentTimeSeconds;
  lastDisplayUpdateMs = performanceNow();
}

function computeDisplayBounds(settings) {
  const offset = settings.offsetSeconds;
  const lead = settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS;

  if (!registeredExpressions.size) {
    const min = currentTimeSeconds - offset;
    const max = currentTimeSeconds + lead;
    return { min, max };
  }

  let min = -Infinity;
  let max = Infinity;

  for (const expression of registeredExpressions.values()) {
    const samples = expression.samples;
    if (!samples || samples.length === 0) {
      min = Math.max(min, currentTimeSeconds - offset);
      max = Math.min(max, currentTimeSeconds + lead);
      continue;
    }

    const first = samples[0]?.time ?? currentTimeSeconds;
    const last = samples[samples.length - 1]?.time ?? currentTimeSeconds;
    min = Math.max(min, first + offset);
    max = Math.min(max, last - offset);
  }

  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
    return { min: currentTimeSeconds, max: currentTimeSeconds };
  }

  return { min, max };
}

function updateDisplayClock(settings) {
  const { min, max } = computeDisplayBounds(settings);
  const nowMs = performanceNow();

  if (lastDisplayUpdateMs === null) {
    lastDisplayUpdateMs = nowMs;
    displayTimeSeconds = clamp(currentTimeSeconds, min, max);
    return displayTimeSeconds;
  }

  const elapsedSeconds = Math.max(0, (nowMs - lastDisplayUpdateMs) / 1000);
  lastDisplayUpdateMs = nowMs;

  const desired = displayTimeSeconds + elapsedSeconds * DISPLAY_RATE_SECONDS_PER_SECOND;
  const clamped = clamp(desired, min, max);

  // If data availability shrank, immediately clamp into the safe range.
  if (displayTimeSeconds > max) {
    displayTimeSeconds = max;
  } else if (displayTimeSeconds < min) {
    displayTimeSeconds = min;
  } else {
    displayTimeSeconds = clamped;
  }

  return displayTimeSeconds;
}

function loadSettings() {
  const visual = activeUserSettings.visualisation;
  settingsCache = clampSettings(visual);
  refreshExpressionColorsFromSettings(settingsCache);
  resetDisplayClock();
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
    const settings = getSettings();
    const displayTime = updateDisplayClock(settings);
    window.dispatchEvent(
      new CustomEvent('useq-visualisation-changed', {
        detail: {
          kind,
          currentTimeSeconds,
          displayTimeSeconds: displayTime,
          settings,
          expressions: registeredExpressions,
          bar: currentBarValue,
        }
      })
    );
  } catch (error) {
    dbg(`visualisationController: failed to dispatch change event: ${error}`);
  }
}

function resolveColor(exprType) {
  if (!exprType) {
    return null;
  }
  const settings = getSettings();
  const palette = getSerialVisPalette();
  const offset = settings?.circularOffset ?? 0;
  const color = getSerialVisChannelColor(exprType, offset, palette);
  if (color) {
    expressionColors.set(exprType, color);
    return color;
  }
  expressionColors.delete(exprType);
  return null;
}

export function reportExpressionColor(exprType, color) {
  if (!exprType) {
    return;
  }
  const appliedColor = color || resolveColor(exprType);
  if (!appliedColor) {
    expressionColors.delete(exprType);
    const existing = registeredExpressions.get(exprType);
    if (existing) {
      existing.color = null;
    }
    return;
  }
  expressionColors.set(exprType, appliedColor);
  const entry = registeredExpressions.get(exprType);
  if (entry) {
    entry.color = appliedColor;
  }
}

function refreshExpressionColorsFromSettings(settings = getSettings()) {
  const palette = getSerialVisPalette();
  const offset = settings?.circularOffset ?? 0;
  for (const [exprType, entry] of registeredExpressions.entries()) {
    const color = getSerialVisChannelColor(exprType, offset, palette);
    if (color) {
      expressionColors.set(exprType, color);
      if (entry) {
        entry.color = color;
      }
    } else {
      expressionColors.delete(exprType);
      if (entry) {
        entry.color = null;
      }
    }
  }
}

function samplingRangeStart(settings) {
  return currentTimeSeconds - settings.offsetSeconds;
}

function samplingRangeEnd(settings) {
  const lead = settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS;
  return currentTimeSeconds + settings.offsetSeconds + lead;
}

function resetSamples(expression, settings) {
  expression.samples = [];
  expression.nextSampleTime = samplingRangeStart(settings);
  expression.needsFutureRefresh = false;
}

async function sampleExpressionAt(expression, targetTime) {
  const value = await evalOutputAtTime(expression.exprType, targetTime);
  expression.samples.push({ time: targetTime, value });
}

async function repopulateExpressionSamples(expression, settings) {
  const step = stepSize(settings);
  if (!Number.isFinite(step) || step <= 0) {
    expression.samples = [];
    const end = samplingRangeEnd(settings);
    await sampleExpressionAt(expression, end);
    expression.nextSampleTime = end + step;
    expression.needsFutureRefresh = false;
    return;
  }

  const start = samplingRangeStart(settings);
  const end = samplingRangeEnd(settings);
  expression.samples = [];

  for (let time = start; time <= end + SAMPLE_EPSILON; time += step) {
    await sampleExpressionAt(expression, time);
  }

  expression.nextSampleTime = end + step;
  expression.needsFutureRefresh = false;
}

async function initialiseSamples(expression, settings) {
  resetSamples(expression, settings);
  await repopulateExpressionSamples(expression, settings);
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
    needsFutureRefresh: false,
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
  await repopulateExpressionSamples(entry, settings);
  notifyStateChanged('update');
}

export function isExpressionVisualised(exprType) {
  return registeredExpressions.has(exprType);
}

export function getVisualisationState() {
  const settings = getSettings();
  const displayTime = updateDisplayClock(settings);
  return {
    currentTime: currentTimeSeconds,
    displayTime,
    settings,
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

export function notifyExpressionEvaluated(exprType = null) {
  if (registeredExpressions.size === 0) {
    return;
  }

  if (exprType && registeredExpressions.has(exprType)) {
    registeredExpressions.get(exprType).needsFutureRefresh = true;
  }

  if (!exprType) {
    for (const expression of registeredExpressions.values()) {
      expression.needsFutureRefresh = true;
    }
    return;
  }

  for (const expression of registeredExpressions.values()) {
    if (expression.exprType !== exprType) {
      expression.needsFutureRefresh = true;
    }
  }
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
    if (registeredExpressions.size === 0) {
      resetDisplayClock();
    }
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
  if (!Number.isFinite(step) || step <= 0) {
    expression.samples = [];
    await sampleExpressionAt(expression, maxTime);
    expression.nextSampleTime = maxTime + step;
    return;
  }

  const futureTarget = maxTime + (settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS);
  const lastSampleTime = expression.samples.length > 0
    ? expression.samples[expression.samples.length - 1].time
    : samplingRangeStart(settings) - step;

  let nextTime = expression.nextSampleTime ?? futureTarget;
  nextTime = Math.max(nextTime, lastSampleTime + step);

  while (nextTime <= futureTarget + SAMPLE_EPSILON) {
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
  const step = stepSize(settings);
  const minTime = samplingRangeStart(settings);
  const maxTime = numericTime + settings.offsetSeconds;

  for (const expression of registeredExpressions.values()) {
    pruneSamples(expression, minTime - step);
    try {
      if (expression.needsFutureRefresh) {
        await repopulateExpressionSamples(expression, settings);
      } else {
        await advanceExpressionSamples(expression, settings, maxTime);
      }
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

if (typeof window !== 'undefined') {
  window.addEventListener('useq-serialvis-palette-changed', () => {
    refreshExpressionColorsFromSettings();
    notifyStateChanged('palette');
  });
}

loadSettings();
