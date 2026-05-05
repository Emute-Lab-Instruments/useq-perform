// Symbol cycle groups for atom manipulation (atom-manipulation.md §3).
// Each group defines a ring of symbols the user can cycle through with LB/RB.

export type CycleGroup = {
  readonly id: string;
  readonly members: readonly string[];
};

export const cycleGroups: readonly CycleGroup[] = [
  { id: "phasors", members: ["beat", "bar", "phrase", "section"] },
  { id: "phasor-durations", members: ["beat-dur", "bar-dur"] },
  { id: "time-warps", members: ["fast", "slow", "offset"] },
  { id: "waveshapes", members: ["sin", "cos", "usin", "ucos", "tan", "tri", "sqr", "pulse"] },
  { id: "oscillators", members: ["osc", "tri-osc", "saw", "sqr-osc", "lfo", "phasor"] },
  { id: "arithmetic", members: ["+", "-", "*", "/", "%"] },
  { id: "comparison", members: [">", "<", ">=", "<=", "="] },
  { id: "logic", members: ["and", "or", "not"] },
  { id: "sequencers", members: ["from-list", "flatseq", "interp"] },
  { id: "gate-patterns", members: ["gates", "gatesw", "trigs", "euclid"] },
  { id: "range-map", members: ["scale", "clamp", "lerp"] },
  { id: "smoothing", members: ["slew", "one-pole", "env-follow"] },
  { id: "random", members: ["random", "index-rand", "noise"] },
  { id: "range-convert", members: ["bi-to-uni", "uni-to-bi"] },
  { id: "rounding", members: ["floor", "ceil", "frac", "abs"] },
  { id: "state", members: ["sah", "toggle", "count", "integrate"] },
  { id: "inputs", members: ["in1", "in2", "ain1", "ain2"] },
  { id: "switches", members: ["swm", "swt", "swr", "rot"] },
];

// Aliases map to their primary name (§3.1.1).
export const aliases: Readonly<Record<string, string>> = {
  seq: "from-list",
  eu: "euclid",
  shift: "offset",
  latch: "sah",
};

// Keyword cycle groups (§3.8).
export const keywordGroups: readonly CycleGroup[] = [
  { id: "wave-keywords", members: [":sin", ":tri", ":saw", ":sqr"] },
];

// Precomputed lookup: symbol → { groupId, index }
type GroupEntry = { readonly groupId: string; readonly index: number };
const symbolIndex: Map<string, GroupEntry> = new Map();
for (const group of cycleGroups) {
  for (let i = 0; i < group.members.length; i++) {
    symbolIndex.set(group.members[i], { groupId: group.id, index: i });
  }
}

const keywordIndex: Map<string, GroupEntry> = new Map();
for (const group of keywordGroups) {
  for (let i = 0; i < group.members.length; i++) {
    keywordIndex.set(group.members[i], { groupId: group.id, index: i });
  }
}

export type CycleResult =
  | { readonly kind: "cycled"; readonly newValue: string; readonly groupId: string; readonly index: number; readonly members: readonly string[] }
  | { readonly kind: "alias-normalized"; readonly newValue: string; readonly groupId: string; readonly index: number; readonly members: readonly string[] }
  | { readonly kind: "no-group" };

export function cycleSymbol(symbol: string, direction: 1 | -1): CycleResult {
  // Check alias first (§3.1.1): first cycle step normalizes to primary.
  const primary = aliases[symbol];
  if (primary !== undefined) {
    const entry = symbolIndex.get(primary);
    if (entry) {
      const group = cycleGroups.find(g => g.id === entry.groupId)!;
      return { kind: "alias-normalized", newValue: primary, groupId: entry.groupId, index: entry.index, members: group.members };
    }
  }

  const entry = symbolIndex.get(symbol);
  if (!entry) return { kind: "no-group" };

  const group = cycleGroups.find(g => g.id === entry.groupId)!;
  const len = group.members.length;
  const nextIndex = ((entry.index + direction) % len + len) % len;
  return { kind: "cycled", newValue: group.members[nextIndex], groupId: entry.groupId, index: nextIndex, members: group.members };
}

export function cycleKeyword(keyword: string, direction: 1 | -1): CycleResult {
  const entry = keywordIndex.get(keyword);
  if (!entry) return { kind: "no-group" };

  const group = keywordGroups.find(g => g.id === entry.groupId)!;
  const len = group.members.length;
  const nextIndex = ((entry.index + direction) % len + len) % len;
  return { kind: "cycled", newValue: group.members[nextIndex], groupId: entry.groupId, index: nextIndex, members: group.members };
}
