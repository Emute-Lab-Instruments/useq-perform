// @ts-nocheck
import { dbg } from "../../lib/debug.ts";
import { getAppSettings, subscribeAppSettings } from "../../runtime/appSettingsRepository.ts";
import { evalInUseqWasm, updateUseqWasmTime, evalOutputAtTime, evalOutputsInTimeWindow } from "../../runtime/wasmInterpreter.ts";
import { getSerialVisPalette, getSerialVisChannelColor } from "../../lib/visualisationUtils.ts";
import { codeEvaluated as codeEvaluatedChannel } from "../../contracts/runtimeChannels";
import {
  visualisationSessionChannel,
  serialVisPaletteChangedChannel,
} from "../../contracts/visualisationChannels";

const registeredExpressions = new Map();
const expressionColors = new Map();
let currentTimeSeconds = 0;
let currentBarValue = 0;
let settingsCache = null;
let pendingRegistration = new Map();
let displayTimeSeconds = 0;
let lastDisplayUpdateMs = null;
let fullRebuildPromise = null;

const DEFAULT_FUTURE_LEAD_SECONDS = 1;
const MAX_FUTURE_LEAD_SECONDS = 8;
const DISPLAY_RATE_SECONDS_PER_SECOND = 1;
const SAMPLE_EPSILON = 1e-9;

function createExpressionSnapshot() {
  const snapshot = {};
  for (const [exprType, expression] of registeredExpressions.entries()) {
    snapshot[exprType] = {
      exprType: expression.exprType,
      expressionText: expression.expressionText ?? "",
      samples: Array.isArray(expression.samples) ? [...expression.samples] : [],
      color: expression.color ?? null,
    };
  }
  return snapshot;
}

function sampleStep(settings) {
  const windowDuration = Number.isFinite(settings.windowDuration) ? settings.windowDuration : 0;
  const sampleCount = Number.isFinite(settings.sampleCount) ? settings.sampleCount : 0;
  if (sampleCount <= 1) {
    return windowDuration;
  }
  if (windowDuration <= 0) {
    return 0;
  }
  return windowDuration / (sampleCount - 1);
}

function quantizeToStep(value, step) {
  if (!Number.isFinite(step) || step <= 0) {
    return value;
  }
  return Math.round(value / step) * step;
}

function ensureGridAlignment(expression, settings, { forceReset = false } = {}) {
  const step = sampleStep(settings);
  const stepDiffers = !Number.isFinite(expression.gridStep) || Math.abs(expression.gridStep - step) > SAMPLE_EPSILON;
  const needsReset = forceReset || stepDiffers || expression.gridSampleCount !== settings.sampleCount || expression.gridWindowDuration !== settings.windowDuration;

  if (needsReset) {
    const halfWindow = settings.windowDuration / 2;
    const referenceTime = Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : 0;
    const centre = quantizeToStep(referenceTime, step);
    const start = Number.isFinite(centre) ? centre - halfWindow : -halfWindow;
    expression.gridStart = start;
    expression.gridStep = step;
    expression.gridSampleCount = settings.sampleCount;
    expression.gridWindowDuration = settings.windowDuration;
    expression.samples = [];
    expression.nextSampleTime = start;
  } else if (!Array.isArray(expression.samples)) {
    expression.samples = [];
  }

  expression.gridFutureLead = settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS;
  return needsReset;
}

function totalSamplesForSettings(expression, settings) {
  const baseCount = Math.max(1, settings.sampleCount);
  const step = Number.isFinite(expression.gridStep) ? expression.gridStep : sampleStep(settings);
  if (!Number.isFinite(step) || step <= SAMPLE_EPSILON) {
    return baseCount;
  }
  const lead = settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS;
  const extra = lead > SAMPLE_EPSILON ? Math.ceil(lead / step) : 0;
  return baseCount + extra;
}

function finalizeSamplingState(expression, settings) {
  const step = Number.isFinite(expression.gridStep) ? expression.gridStep : sampleStep(settings);
  if (expression.samples.length > 0) {
    expression.gridStart = expression.samples[0].time;
    const lastTime = expression.samples[expression.samples.length - 1].time;
    expression.nextSampleTime = Number.isFinite(step) ? lastTime + step : lastTime;
  } else {
    expression.nextSampleTime = expression.gridStart;
  }

  if (!Number.isFinite(expression.nextSampleTime)) {
    expression.nextSampleTime = Number.POSITIVE_INFINITY;
  }

  expression.needsFutureRefresh = false;
}

function getDefaults() {
  return {
    windowDuration: 10,  // Total visible window width in seconds (past + future)
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
  safe.windowDuration = Math.min(20, Math.max(1, Number(safe.windowDuration) || defaults.windowDuration));
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
  const halfWindow = settings.windowDuration / 2;
  const lead = settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS;

  if (!registeredExpressions.size) {
    const min = currentTimeSeconds - halfWindow;
    const max = currentTimeSeconds + halfWindow;
    return { min, max };
  }

  let min = -Infinity;
  let max = Infinity;

  for (const expression of registeredExpressions.values()) {
    const samples = expression.samples;
    if (!samples || samples.length === 0) {
      min = Math.max(min, currentTimeSeconds - halfWindow);
      max = Math.min(max, currentTimeSeconds + halfWindow);
      continue;
    }

    const first = samples[0]?.time ?? currentTimeSeconds;
    const last = samples[samples.length - 1]?.time ?? currentTimeSeconds;
    min = Math.max(min, first + halfWindow);
    max = Math.min(max, last - halfWindow);
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
  const visual = getAppSettings().visualisation;
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

function notifyStateChanged(kind = "change") {
  try {
    const settings = getSettings();
    const displayTime = updateDisplayClock(settings);
    const summary = Array.from(registeredExpressions.values()).map((expr) => `${expr.exprType}:${expr.samples?.length ?? 0}`);
    dbg(`visualisationController: state change (${kind}), expressions=${summary.join(', ')}`);
    visualisationSessionChannel.publish({
      kind,
      currentTimeSeconds,
      displayTimeSeconds: displayTime,
      settings,
      expressions: createExpressionSnapshot(),
      bar: currentBarValue,
    });
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

async function sampleExpressionAt(expression, targetTime) {
  const value = await evalOutputAtTime(expression.exprType, targetTime);
  return { time: targetTime, value };
}

async function rebuildSamples(expression, settings, totalSamples) {
  const step = Number.isFinite(expression.gridStep) ? expression.gridStep : sampleStep(settings);
  const start = expression.gridStart;
  const end = totalSamples > 1 ? start + step * (totalSamples - 1) : start;

  if (totalSamples <= 0) {
    expression.samples = [];
    return;
  }

  try {
    const batchResults = await evalOutputsInTimeWindow(
      [expression.exprType],
      start,
      end,
      totalSamples
    );
    const samples = batchResults.get(expression.exprType) || [];
    dbg(`visualisationController: rebuild ${expression.exprType} received ${samples.length} samples`);
    expression.samples = samples;
  } catch (error) {
    dbg(`visualisationController: batch rebuild failed for ${expression.exprType}, falling back to single sampling: ${error}`);
    const samples = [];
    if (totalSamples === 1) {
      samples.push(await sampleExpressionAt(expression, start));
    } else {
      for (let i = 0; i < totalSamples; i++) {
        const time = start + step * i;
        samples.push(await sampleExpressionAt(expression, time));
      }
    }
    expression.samples = samples;
  }
}

async function resampleExistingSamples(expression, settings) {
  const count = expression.samples.length;
  if (count === 0) {
    return;
  }

  const start = expression.samples[0].time;
  const end = expression.samples[count - 1].time;

  try {
    const batchResults = await evalOutputsInTimeWindow(
      [expression.exprType],
      start,
      end,
      count
    );
    const newSamples = batchResults.get(expression.exprType) || [];
    if (newSamples.length === count) {
      expression.samples = newSamples;
      return;
    }
    dbg(`visualisationController: expected ${count} samples but received ${newSamples.length} for ${expression.exprType}; falling back to per-sample evaluation.`);
  } catch (error) {
    dbg(`visualisationController: batch refresh failed for ${expression.exprType}, falling back to single sampling: ${error}`);
  }

  const refreshed = [];
  for (const sample of expression.samples) {
    const value = await evalOutputAtTime(expression.exprType, sample.time);
    refreshed.push({ time: sample.time, value });
  }
  expression.samples = refreshed;
}

async function repopulateExpressionSamples(expression, settings, options = {}) {
  const { forceRebuild = false } = options;
  const totalSamples = totalSamplesForSettings(expression, settings);
  const needsRebuild = forceRebuild || expression.samples.length !== totalSamples || expression.samples.length === 0;

  if (needsRebuild) {
    await rebuildSamples(expression, settings, totalSamples);
  } else {
    await resampleExistingSamples(expression, settings);
  }

  finalizeSamplingState(expression, settings);
}

async function initialiseSamples(expression, settings) {
  ensureGridAlignment(expression, settings, { forceReset: true });
  await repopulateExpressionSamples(expression, settings, { forceRebuild: true });
}

async function ensureRegistered(exprType, expressionText, settings) {
  const existing = registeredExpressions.get(exprType);
  if (existing) {
    existing.expressionText = expressionText;
    existing.color = resolveColor(exprType);
    const gridReset = ensureGridAlignment(existing, settings);
    await repopulateExpressionSamples(existing, settings, { forceRebuild: gridReset });
    return existing;
  }

  const entry = {
    exprType,
    expressionText,
    samples: [],
    color: resolveColor(exprType),
    nextSampleTime: 0,
    needsFutureRefresh: false,
    gridStart: 0,
    gridStep: sampleStep(settings),
    gridSampleCount: settings.sampleCount,
    gridWindowDuration: settings.windowDuration,
    gridFutureLead: settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS,
  };
  registeredExpressions.set(exprType, entry);
  ensureGridAlignment(entry, settings, { forceReset: true });
  await repopulateExpressionSamples(entry, settings, { forceRebuild: true });
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
  ensureGridAlignment(entry, settings);
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

function markExpressionsForRefresh(targetExprType = null) {
  if (registeredExpressions.size === 0) {
    return;
  }

  if (!targetExprType) {
    for (const expression of registeredExpressions.values()) {
      expression.needsFutureRefresh = true;
    }
    return;
  }

  const target = registeredExpressions.get(targetExprType);
  if (target) {
    target.needsFutureRefresh = true;
  }
}

function scheduleFullRebuild(reason = "data") {
  if (fullRebuildPromise) {
    return fullRebuildPromise;
  }

  const expressions = Array.from(registeredExpressions.values());
  if (expressions.length === 0) {
    return Promise.resolve();
  }

  const settings = getSettings();

  fullRebuildPromise = (async () => {
    for (const expression of expressions) {
      if (!registeredExpressions.has(expression.exprType)) {
        continue;
      }

      try {
        await repopulateExpressionSamples(expression, settings, { forceRebuild: true });
      } catch (error) {
        dbg(`visualisationController: failed to rebuild ${expression.exprType} after evaluation: ${error}`);
      }
    }

    notifyStateChanged(reason);
  })()
    .catch((error) => {
      dbg(`visualisationController: unhandled error during serialVis rebuild: ${error}`);
    })
    .finally(() => {
      fullRebuildPromise = null;
    });

  return fullRebuildPromise;
}

export function notifyExpressionEvaluated(exprType = null) {
  if (registeredExpressions.size === 0) {
    return;
  }

  markExpressionsForRefresh(exprType);
  scheduleFullRebuild();
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

function pruneSamples(expression, minTime, settings) {
  if (!expression.samples.length) {
    expression.gridStart = Number.isFinite(minTime) ? minTime : expression.gridStart;
    return;
  }

  let removeCount = 0;
  while (removeCount < expression.samples.length && expression.samples[removeCount].time < minTime) {
    removeCount++;
  }

  if (removeCount > 0) {
    expression.samples.splice(0, removeCount);
  }

  if (expression.samples.length) {
    expression.gridStart = expression.samples[0].time;
  } else {
    const step = Number.isFinite(expression.gridStep) ? expression.gridStep : sampleStep(settings);
    expression.gridStart = Number.isFinite(minTime) ? minTime : expression.gridStart;
    expression.nextSampleTime = Number.isFinite(step) ? expression.gridStart + step : expression.gridStart;
  }
}

async function advanceExpressionSamples(expression, settings, maxTime) {
  const step = Number.isFinite(expression.gridStep) ? expression.gridStep : sampleStep(settings);
  if (!Number.isFinite(step) || step <= SAMPLE_EPSILON) {
    expression.nextSampleTime = Number.POSITIVE_INFINITY;
    return;
  }

  const futureTarget = maxTime + (settings.futureLeadSeconds ?? DEFAULT_FUTURE_LEAD_SECONDS);
  const lastSampleTime = expression.samples.length > 0
    ? expression.samples[expression.samples.length - 1].time
    : expression.gridStart - step;

  let nextTime = Number.isFinite(expression.nextSampleTime)
    ? expression.nextSampleTime
    : lastSampleTime + step;
  nextTime = Math.max(nextTime, lastSampleTime + step);

  if (nextTime > futureTarget + SAMPLE_EPSILON) {
    expression.nextSampleTime = nextTime;
    return;
  }

  const numNewSamples = Math.floor((futureTarget - nextTime) / step) + 1;
  if (numNewSamples <= 0) {
    expression.nextSampleTime = nextTime;
    return;
  }

  const endTime = nextTime + step * (numNewSamples - 1);

  try {
    const batchResults = await evalOutputsInTimeWindow(
      [expression.exprType],
      nextTime,
      endTime,
      numNewSamples
    );

    const newSamples = batchResults.get(expression.exprType) || [];
    expression.samples.push(...newSamples);
  } catch (error) {
    dbg(`visualisationController: batch advance failed for ${expression.exprType}, falling back to single samples: ${error}`);

    for (let i = 0; i < numNewSamples; i++) {
      const time = nextTime + step * i;
      expression.samples.push(await sampleExpressionAt(expression, time));
    }
  }

  expression.nextSampleTime = endTime + step;
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
  const step = sampleStep(settings);
  const halfWindow = settings.windowDuration / 2;
  const minTime = numericTime - halfWindow;
  const maxTime = numericTime + halfWindow;

  for (const expression of registeredExpressions.values()) {
    pruneSamples(expression, minTime - step, settings);
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
    // Evaluate bar at displayTime for consistency with visualization
    const settings = getSettings();
    const displayTime = updateDisplayClock(settings);
    const result = await evalOutputAtTime("bar", displayTime);
    const numeric = Number(result);
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

if (typeof window !== 'undefined') {
  // Defer all subscriptions to avoid circular dependency TDZ errors during
  // module initialisation (appSettingsRepository hasn't finished initialising
  // its module-level `listeners` Set when this module is first evaluated).
  // Use setTimeout(0) to push past the ESM module evaluation phase.
  setTimeout(() => {
    loadSettings();

    subscribeAppSettings(() => {
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
  }, 0);

  codeEvaluatedChannel.subscribe(() => {
    markExpressionsForRefresh();
    scheduleFullRebuild();
  });

  serialVisPaletteChangedChannel.subscribe(() => {
    refreshExpressionColorsFromSettings();
    notifyStateChanged('palette');
  });
}
