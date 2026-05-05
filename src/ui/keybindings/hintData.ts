import { defaultKeyBindings } from "../../lib/keybindings/defaults.ts";
import { actions, type ActionId, type ActionCategory } from "../../lib/keybindings/actions.ts";

export interface HintEntry {
  key: string;
  displayKey: string;
  actionId: ActionId | null;
  description: string;
  category: ActionCategory;
  isChord: boolean;
  children?: HintEntry[];
}

export type HintStyle = "cursor" | "bar" | "modal";

export const CATEGORY_ORDER: ActionCategory[] = [
  "core",
  "editor",
  "structure",
  "format",
  "probe",
  "navigation",
  "ui",
  "transport",
];

const CATEGORY_LABELS: Record<string, string> = {
  core: "Core",
  editor: "Editor",
  structure: "Structure",
  format: "Format",
  probe: "Probe",
  navigation: "Navigation",
  ui: "UI",
  transport: "Transport",
};

export function categoryLabel(cat: ActionCategory): string {
  return CATEGORY_LABELS[cat] ?? cat;
}

const DISPLAY_KEY_MAP: Record<string, string> = {
  Enter: "⏎",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Backspace: "⌫",
  Delete: "Del",
  Escape: "Esc",
  Tab: "⇥",
  " ": "Space",
};

function displayKey(key: string): string {
  return DISPLAY_KEY_MAP[key] ?? key;
}

const isMac =
  typeof navigator !== "undefined" &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const MODIFIER_KEYS: Record<string, string> = {
  Control: "Ctrl",
  Alt: "Alt",
  Meta: "Meta",
  Shift: "Shift",
};

export { MODIFIER_KEYS };

export const MODIFIER_LABELS: Record<string, string> = {
  Ctrl: "Ctrl",
  Alt: "Alt",
  Meta: "Cmd",
  Shift: "Shift",
};

function prefixesForModifier(modifier: string): string[] {
  const prefixes = [modifier + "-"];
  if (modifier === "Ctrl" && !isMac) prefixes.push("Mod-");
  if (modifier === "Meta" && isMac) prefixes.push("Mod-");
  return prefixes;
}

export function isChordLeader(modifier: string, key: string): boolean {
  const prefixes = prefixesForModifier(modifier);
  for (const binding of defaultKeyBindings) {
    if (binding.when) continue;
    const matched = prefixes.find((p) => binding.key.startsWith(p));
    if (!matched) continue;
    const remainder = binding.key.slice(matched.length);
    if (remainder.startsWith(key + " ")) return true;
  }
  return false;
}

export function getHintsForModifier(modifier: string): HintEntry[] {
  const prefixes = prefixesForModifier(modifier);
  const seen = new Set<string>();
  const entries: HintEntry[] = [];

  for (const binding of defaultKeyBindings) {
    if (binding.when) continue;

    const matchedPrefix = prefixes.find((p) => binding.key.startsWith(p));
    if (!matchedPrefix) continue;

    const remainder = binding.key.slice(matchedPrefix.length);
    if (!remainder) continue;

    const isChord = remainder.includes(" ");
    const rawKey = isChord ? remainder.split(" ")[0] : remainder;

    const dedupeKey = isChord ? `chord:${rawKey}` : `key:${rawKey}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const action = actions[binding.action as ActionId];

    if (isChord) {
      const children = getChordCompletions(matchedPrefix + rawKey);
      const cats = [...new Set(children.map((c) => c.category))];
      const label = cats.length === 1 ? (categoryLabel(cats[0]) + "...") : "More...";

      entries.push({
        key: rawKey,
        displayKey: displayKey(rawKey),
        actionId: null,
        description: label,
        category: cats[0] ?? "core",
        isChord: true,
        children,
      });
    } else {
      entries.push({
        key: rawKey,
        displayKey: displayKey(rawKey),
        actionId: binding.action as ActionId,
        description: action?.description ?? binding.action,
        category: action?.category ?? "core",
        isChord: false,
      });
    }
  }

  entries.sort((a, b) => {
    if (a.isChord !== b.isChord) return a.isChord ? 1 : -1;
    return a.key.localeCompare(b.key);
  });

  return entries;
}

export function getChordCompletions(prefix: string): HintEntry[] {
  const fullPrefix = prefix + " ";
  const entries: HintEntry[] = [];

  for (const binding of defaultKeyBindings) {
    if (binding.when) continue;
    if (!binding.key.startsWith(fullPrefix)) continue;

    const secondKey = binding.key.slice(fullPrefix.length);
    if (!secondKey || secondKey.includes(" ")) continue;

    const action = actions[binding.action as ActionId];
    entries.push({
      key: secondKey,
      displayKey: displayKey(secondKey),
      actionId: binding.action as ActionId,
      description: action?.description ?? binding.action,
      category: action?.category ?? "core",
      isChord: false,
    });
  }

  return entries;
}

export function groupByCategory(entries: HintEntry[]): Map<ActionCategory, HintEntry[]> {
  const grouped = new Map<ActionCategory, HintEntry[]>();

  for (const cat of CATEGORY_ORDER) {
    const items = entries.filter((e) => e.category === cat);
    if (items.length > 0) grouped.set(cat, items);
  }

  // Catch any categories not in CATEGORY_ORDER
  for (const entry of entries) {
    if (!CATEGORY_ORDER.includes(entry.category)) {
      const existing = grouped.get(entry.category) ?? [];
      existing.push(entry);
      grouped.set(entry.category, existing);
    }
  }

  return grouped;
}

export function columnCount(style: HintStyle, entryCount: number): 1 | 2 | 3 {
  if (style === "cursor") return 1;
  if (entryCount <= 6) return 1;
  if (entryCount <= 14) return 2;
  return 3;
}
