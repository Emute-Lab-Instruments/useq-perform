import { loadReferenceDataFromCandidates } from "./referenceDataLoader.ts";
import { load, PERSISTENCE_KEYS } from "./persistence.ts";

async function loadReferenceData() {
  try {
    return await loadReferenceDataFromCandidates();
  } catch {
    // Fall back to empty array so the picker menu still renders.
    return [];
  }
}

function readStarredFunctions() {
  const list = load<string[]>(PERSISTENCE_KEYS.referenceStarred, []);
  return Array.isArray(list) ? new Set(list) : new Set();
}

function makeInsertTextForName(name) {
  // Simple template: surround with parentheses unless already a literal
  if (/^(Number)$/i.test(name)) return "0";
  if (/^[\+\-\*\/%=<>!]+$/.test(name)) return `(${name} )`;
  return `(${name} )`;
}

function bucketizeFunctions(data) {
  const buckets = {
    Maths: [],
    Control: [],
    Lists: [],
    Utils: []
  };
  data.forEach(fn => {
    const tags = (fn.tags || []).map(t => String(t).toLowerCase());
    const entry = { label: fn.name, value: fn.name, insertText: makeInsertTextForName(fn.name) };
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
  Object.keys(buckets).forEach(k => {
    buckets[k] = buckets[k]
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 12);
  });
  return buckets;
}

export async function buildHierarchicalMenuModel() {
  const data = await loadReferenceData();
  const buckets = bucketizeFunctions(data);
  const starred = readStarredFunctions();

  const favorites = Array.from(starred)
    .map(name => ({ label: name, value: name, insertText: makeInsertTextForName(name) }))
    .slice(0, 12);

  // Ensure we always offer a Number literal picker
  const literals = [{ label: 'Number…', value: '__NUMBER__', special: 'number' }];

  const categories = [];
  if (favorites.length) categories.push({ label: 'Favorites', id: 'favorites', items: favorites });
  categories.push(
    { label: 'Literals', id: 'literals', items: literals },
    { label: 'Maths', id: 'maths', items: buckets.Maths },
    { label: 'Control', id: 'control', items: buckets.Control },
    { label: 'Lists', id: 'lists', items: buckets.Lists },
    { label: 'Utils', id: 'utils', items: buckets.Utils }
  );

  // Filter empty categories (except Literals)
  const filtered = categories.filter(c => c.id === 'literals' || (Array.isArray(c.items) && c.items.length));
  return filtered;
}

