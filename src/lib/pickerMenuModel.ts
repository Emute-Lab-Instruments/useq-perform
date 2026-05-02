import { loadReferenceDataFromCandidates } from "./referenceDataLoader.ts";
import { load, PERSISTENCE_KEYS } from "./persistence.ts";

interface ReferenceFunction {
  name: string;
  tags?: unknown[];
}

interface MenuItem {
  label: string;
  value: string;
  insertText?: string;
  special?: string;
}

interface MenuCategory {
  label: string;
  id: string;
  items: MenuItem[];
}

interface FunctionBuckets {
  Maths: MenuItem[];
  Control: MenuItem[];
  Lists: MenuItem[];
  Utils: MenuItem[];
}

type BucketKey = keyof FunctionBuckets;

async function loadReferenceData(): Promise<ReferenceFunction[]> {
  try {
    return (await loadReferenceDataFromCandidates()) as ReferenceFunction[];
  } catch {
    // Fall back to empty array so the picker menu still renders.
    return [];
  }
}

function readStarredFunctions(): Set<string> {
  const list = load<string[]>(PERSISTENCE_KEYS.referenceStarred, []);
  return Array.isArray(list) ? new Set(list) : new Set<string>();
}

function makeInsertTextForName(name: string): string {
  // Simple template: surround with parentheses unless already a literal
  if (/^(Number)$/i.test(name)) return "0";
  if (/^[\+\-\*\/%=<>!]+$/.test(name)) return `(${name} )`;
  return `(${name} )`;
}

function bucketizeFunctions(data: ReferenceFunction[]): FunctionBuckets {
  const buckets: FunctionBuckets = {
    Maths: [],
    Control: [],
    Lists: [],
    Utils: []
  };
  data.forEach((fn) => {
    const tags = (fn.tags || []).map((t) => String(t).toLowerCase());
    const entry: MenuItem = { label: fn.name, value: fn.name, insertText: makeInsertTextForName(fn.name) };
    if (tags.includes('maths')) {
      buckets.Maths.push(entry);
      return;
    }
    if (tags.includes('evaluation control')) {
      buckets.Control.push(entry);
      return;
    }
    if (tags.includes('list')) {
      buckets.Lists.push(entry);
      return;
    }
    buckets.Utils.push(entry);
  });
  // Provide a deterministic, short list for menus
  (Object.keys(buckets) as BucketKey[]).forEach((k) => {
    buckets[k] = buckets[k]
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 12);
  });
  return buckets;
}

export async function buildHierarchicalMenuModel(): Promise<MenuCategory[]> {
  const data = await loadReferenceData();
  const buckets = bucketizeFunctions(data);
  const starred = readStarredFunctions();

  const favorites: MenuItem[] = Array.from(starred)
    .map((name) => ({ label: name, value: name, insertText: makeInsertTextForName(name) }))
    .slice(0, 12);

  // Ensure we always offer a Number literal picker
  const literals: MenuItem[] = [{ label: 'Number…', value: '__NUMBER__', special: 'number' }];

  const categories: MenuCategory[] = [];
  if (favorites.length) categories.push({ label: 'Favorites', id: 'favorites', items: favorites });
  categories.push(
    { label: 'Literals', id: 'literals', items: literals },
    { label: 'Maths', id: 'maths', items: buckets.Maths },
    { label: 'Control', id: 'control', items: buckets.Control },
    { label: 'Lists', id: 'lists', items: buckets.Lists },
    { label: 'Utils', id: 'utils', items: buckets.Utils }
  );

  // Filter empty categories (except Literals)
  return categories.filter((c) => c.id === 'literals' || (Array.isArray(c.items) && c.items.length > 0));
}
