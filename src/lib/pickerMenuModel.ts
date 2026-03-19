import { dbg } from "./debug.ts";

// Reuse the reference-data loader strategy from the help panel
function candidateDataUrls() {
  const candidates = new Set();
  const rel = [
    "../../assets/modulisp_reference_data.json",
    "../assets/modulisp_reference_data.json",
    "./assets/modulisp_reference_data.json",
    "assets/modulisp_reference_data.json",
    "/assets/modulisp_reference_data.json",
    "/dev/assets/modulisp_reference_data.json"
  ];
  const base = (typeof import.meta !== 'undefined' && import.meta.url) ? import.meta.url : (typeof window !== 'undefined' ? window.location.href : null);
  rel.forEach(p => {
    try { candidates.add(new URL(p, base || 'http://local/').href); } catch (_) {}
  });
  return Array.from(candidates);
}

async function loadReferenceData() {
  const urls = candidateDataUrls();
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (res && res.ok) {
        const data = await res.json();
        if (Array.isArray(data)) return data;
      }
    } catch (e) { dbg('pickerMenuData: fetch failed', url, e); }
  }
  return [];
}

function readStarredFunctions() {
  try {
    const raw = window.localStorage.getItem("moduLispReference:starredFunctions");
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? new Set(list) : new Set();
  } catch (_) {
    return new Set();
  }
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

