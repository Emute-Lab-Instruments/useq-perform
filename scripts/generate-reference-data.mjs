import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SYMBOLS_PATH = path.join(
  ROOT,
  "src-useq",
  "uSEQ",
  "src",
  "signal_engine",
  "symbols.def",
);
const SYNTH_REGISTRY_PATH = path.join(
  ROOT,
  "src-useq",
  "uSEQ",
  "src",
  "signal_engine",
  "synth_registry.cpp",
);
export const REFERENCE_DATA_PATH = path.join(
  ROOT,
  "assets",
  "modulisp_reference_data.json",
);
export const PUBLIC_REFERENCE_DATA_PATH = path.join(
  ROOT,
  "public",
  "assets",
  "modulisp_reference_data.json",
);

export const NAMESPACE_SET = [
  { name: "n", long_name: "norm", semantics: "input is a normalised phasor; one cycle per unit" },
  { name: "r", long_name: "rad", semantics: "input is an angle in radians" },
  { name: "u", long_name: "uni", semantics: "output is mapped to the unipolar range" },
  { name: "b", long_name: "bi", semantics: "output is mapped to the bipolar range" },
  { name: "lfo", semantics: "free-running unipolar oscillator; rate is in hertz" },
  { name: "blfo", semantics: "free-running bipolar oscillator; rate is in hertz" },
  { name: "osc", semantics: "top-level audio-rate NodeDef from the synth registry" },
  { name: "k", long_name: "once", semantics: "evaluate once when the program is compiled" },
  { name: "raw", semantics: "engine-native meaning, immune to bare-default changes" },
];

const REMOVED_NAMES = new Set(["usin", "ucos", "osc", "tri-osc", "sqr-osc"]);

const REFERENCE_OVERRIDES = {
  sin: {
    description: "Unipolar sine shaper over a normalised phasor. Equivalent to n/sin.",
    examples: ["(sin beat)", "(r/sin 1.5707963267948966) ;; => 1"],
  },
  cos: {
    description: "Unipolar cosine shaper over a normalised phasor. Equivalent to n/cos.",
    examples: ["(cos beat)", "(r/cos 0) ;; => 1"],
  },
  bsin: {
    description: "Bipolar sine shaper over a normalised phasor. Equivalent to b/sin.",
    examples: ["(bsin beat)", "(b/sin beat)"],
  },
  bcos: {
    description: "Bipolar cosine shaper over a normalised phasor. Equivalent to b/cos.",
    examples: ["(bcos beat)", "(b/cos beat)"],
  },
  saw: {
    description: "Pure unipolar saw shaper over a normalised phasor; allocates no state.",
    examples: ["(saw beat)", "(lfo/saw 2) ;; free-running at 2 Hz"],
  },
  pulse: {
    description: "Width-configured unipolar pulse shaper. The driving phasor is last.",
    examples: ["(pulse 0.25 beat)"],
  },
  lfo: {
    description: "Free-running unipolar oscillator. Rate is in hertz; :wave selects the shape.",
    examples: ["(lfo 2)", "(lfo/saw 0.5)"],
  },
  blfo: {
    description: "Free-running bipolar oscillator. Rate is in hertz; :wave selects the shape.",
    examples: ["(blfo 2)", "(blfo/tri 0.5)"],
  },
  euclid: {
    description: "Euclidean rhythm generator with hits first and the driving phasor last.",
    parameters: [
      { name: "hits", description: "Active hits distributed through the pattern", range: "integer >= 0" },
      { name: "total", description: "Total steps in the pattern", range: "integer > 0" },
      { name: "pulse-width", description: "Optional width of each hit", range: "0-1", optional: true },
      { name: "rotation", description: "Optional right rotation in steps", range: "integer", optional: true },
      { name: "phasor", description: "Driving phasor; always the final argument", range: "0-1" },
    ],
    examples: ["(euclid 3 8 bar)", "(euclid 3 8 0.3 2 bar)"],
  },
  eu: {
    description: "Short spelling of euclid, with the same hits-first, phasor-last signature.",
    examples: ["(eu 3 8 bar)", "(eu 3 8 0.3 2 bar)"],
  },
};

function parseInventory(text) {
  const symbols = new Map();
  for (const match of text.matchAll(/^SYM\(\s*([^,]+),\s*"([^"]+)",\s*([^\s)]+)\s*\)/gm)) {
    const [, field, name, category] = match;
    if (!symbols.has(field)) symbols.set(field, { field, name, category });
  }

  const declarations = [...symbols.values()]
    .filter((symbol) => symbol.category !== "none")
    .map((symbol) => ({
      ...symbol,
      input_domain: "None",
      output_range: "None",
      regime: "None",
      cold_evaluable: "No",
      bare_identity: "Native",
    }));
  const declarationByField = new Map(declarations.map((declaration) => [declaration.field, declaration]));
  for (const match of text.matchAll(
    /^OP_META\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^\s)]+)\s*\)/gm,
  )) {
    const [, field, input_domain, output_range, regime, cold_evaluable, bare_identity] = match;
    const symbol = symbols.get(field);
    if (!symbol) throw new Error(`OP_META references unknown symbol field ${field}`);
    declarationByField.set(field, {
      ...declarationByField.get(field),
      input_domain,
      output_range,
      regime,
      cold_evaluable,
      bare_identity,
    });
  }
  return [...declarationByField.values()];
}

function migrateRemovedSpellings(value) {
  if (typeof value === "string") {
    return value
      .replace(/\busin\b/g, "sin")
      .replace(/\bucos\b/g, "cos")
      .replace(/\btri-osc\b/g, "lfo/tri")
      .replace(/\bsqr-osc\b/g, "lfo/sqr")
      .replace(/\(osc(?=\s)/g, "(lfo/sin");
  }
  if (Array.isArray(value)) return value.map(migrateRemovedSpellings);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [key, migrateRemovedSpellings(child)]),
    );
  }
  return value;
}

function applicableNamespaces(declaration) {
  const result = [];
  if (["Angle", "Phase"].includes(declaration.input_domain)) result.push("n", "r");
  if (declaration.output_range !== "None") result.push("u", "b");
  if (declaration.regime === "PureShaper") result.push("lfo", "blfo");
  if (declaration.cold_evaluable === "Yes") result.push("k");
  result.push("raw");
  return result;
}

function bareIdentity(declaration) {
  switch (declaration.bare_identity) {
    case "NormalizedUnipolar": return `n/${declaration.name}`;
    case "NormalizedBipolar":
      return declaration.name.startsWith("b")
        ? `b/${declaration.name.slice(1)}`
        : `b/${declaration.name}`;
    case "UnipolarShaper": return `u/${declaration.name}`;
    case "LfoUnipolar": return "lfo/sin";
    case "LfoBipolar": return "blfo/sin";
    default: return `raw/${declaration.name}`;
  }
}

function namespaceApplicability(declaration) {
  return applicableNamespaces(declaration).map((namespace) => ({
    namespace,
    spelling: `${namespace}/${declaration.name}`,
    identity: namespace === "raw"
      ? `engine-native ${declaration.name}`
      : `${namespace}/${declaration.name}`,
  }));
}

function loadExistingEntries() {
  if (!fs.existsSync(REFERENCE_DATA_PATH)) return [];
  const parsed = JSON.parse(fs.readFileSync(REFERENCE_DATA_PATH, "utf8"));
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.operators)) return parsed.operators;
  throw new Error(`${REFERENCE_DATA_PATH} has no operator array`);
}

function writeIfChanged(destination, value) {
  const serialized = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(destination) && fs.readFileSync(destination, "utf8") === serialized) return;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, serialized);
}

export function generateReferenceData() {
  const inventory = parseInventory(fs.readFileSync(SYMBOLS_PATH, "utf8"));
  const existing = loadExistingEntries()
    .filter((entry) => !REMOVED_NAMES.has(entry.name))
    .map(migrateRemovedSpellings);
  const byName = new Map(existing.map((entry) => [entry.name, entry]));

  for (const declaration of inventory) {
    const prior = byName.get(declaration.name) ?? {
      name: declaration.name,
      aliases: [],
      description: `${declaration.name} operator.`,
      parameters: [],
      examples: [],
      category: declaration.category,
      tags: [declaration.category],
    };
    byName.set(declaration.name, {
      ...prior,
      ...(REFERENCE_OVERRIDES[declaration.name] ?? {}),
      bare_identity: bareIdentity(declaration),
      namespace_applicability: namespaceApplicability(declaration),
      operator_declaration: {
        input_domain: declaration.input_domain,
        output_range: declaration.output_range,
        regime: declaration.regime,
        cold_evaluable: declaration.cold_evaluable === "Yes",
      },
    });
  }

  const registryText = fs.readFileSync(SYNTH_REGISTRY_PATH, "utf8");
  const nodeDefs = [...new Set([...registryText.matchAll(/"(osc\/[a-zA-Z0-9_-]+)"/g)].map((match) => match[1]))];
  for (const name of nodeDefs) {
    if (!byName.has(name)) {
      byName.set(name, {
        name,
        aliases: [],
        description: `Audio-rate ${name} synth node from the runtime registry.`,
        parameters: [],
        examples: [`(${name} :freq 440)`],
        category: "synth",
        tags: ["synth", "osc"],
      });
    }
    const entry = byName.get(name);
    byName.set(name, {
      ...entry,
      namespace_applicability: [{ namespace: "osc", spelling: name, identity: name }],
    });
  }

  const document = {
    schema_version: 2,
    generated_from: [
      "src-useq/uSEQ/src/signal_engine/symbols.def",
      "src-useq/uSEQ/src/signal_engine/synth_registry.cpp",
    ],
    namespaces: NAMESPACE_SET,
    operators: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
  writeIfChanged(REFERENCE_DATA_PATH, document);
  writeIfChanged(PUBLIC_REFERENCE_DATA_PATH, document);
  return document;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  generateReferenceData();
}
