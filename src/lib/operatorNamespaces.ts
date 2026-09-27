import type {
  NamespaceDefinition,
  ReferenceEntry,
} from "../utils/referenceStore.ts";

export interface NamespaceSpans {
  namespace: { from: number; to: number };
  operator: { from: number; to: number };
}

export interface NamespaceChoice {
  namespace: string | null;
  label: string;
  spelling: string;
  identity: string;
  semantics: string;
  current: boolean;
}

const LONG_TO_SHORT: Readonly<Record<string, string>> = {
  norm: "n",
  rad: "r",
  uni: "u",
  bi: "b",
  once: "k",
};

export function namespaceSpans(symbol: string): NamespaceSpans | null {
  if (symbol === "/") return null;
  const slash = symbol.indexOf("/");
  if (slash <= 0 || slash === symbol.length - 1 || symbol.indexOf("/", slash + 1) !== -1) {
    return null;
  }
  return {
    namespace: { from: 0, to: slash },
    operator: { from: slash + 1, to: symbol.length },
  };
}

export function operatorName(symbol: string): string {
  const spans = namespaceSpans(symbol);
  return spans ? symbol.slice(spans.operator.from, spans.operator.to) : symbol;
}

export function canonicalizeNamespaceSpelling(symbol: string): string {
  const spans = namespaceSpans(symbol);
  if (!spans) return symbol;
  const current = symbol.slice(spans.namespace.from, spans.namespace.to);
  const canonical = LONG_TO_SHORT[current];
  return canonical ? `${canonical}/${operatorName(symbol)}` : symbol;
}

export function namespaceChoices(
  symbol: string,
  entry: ReferenceEntry,
  definitions: ReadonlyArray<NamespaceDefinition>,
): NamespaceChoice[] {
  const spans = namespaceSpans(symbol);
  const currentPrefix = spans
    ? symbol.slice(spans.namespace.from, spans.namespace.to)
    : null;
  const currentCanonical = currentPrefix ? (LONG_TO_SHORT[currentPrefix] ?? currentPrefix) : null;
  const preferLong = Boolean(
    currentPrefix && definitions.some((definition) => definition.longName === currentPrefix),
  );
  const definitionByName = new Map(definitions.map((definition) => [definition.name, definition]));
  const baseName = operatorName(entry.name);
  const choices: NamespaceChoice[] = entry.namespaceApplicability.map((applicability) => {
    const definition = definitionByName.get(applicability.namespace);
    const prefix = preferLong && definition?.longName
      ? definition.longName
      : applicability.namespace;
    return {
      namespace: applicability.namespace,
      label: `${prefix}/`,
      spelling: `${prefix}/${baseName}`,
      identity: applicability.identity,
      semantics: definition?.semantics ?? "",
      current: currentCanonical === applicability.namespace,
    };
  });
  if (entry.bareIdentity) {
    choices.unshift({
      namespace: null,
      label: "bare",
      spelling: baseName,
      identity: entry.bareIdentity,
      semantics: `declared default: ${entry.bareIdentity}`,
      current: currentPrefix === null,
    });
  }
  return choices;
}

export function namespaceHint(
  symbol: string,
  entry: ReferenceEntry,
  definitions: ReadonlyArray<NamespaceDefinition>,
): { title: string; semantics: string; identity: string } | null {
  const spans = namespaceSpans(symbol);
  if (!spans) return null;
  const prefix = symbol.slice(spans.namespace.from, spans.namespace.to);
  const canonical = LONG_TO_SHORT[prefix] ?? prefix;
  const applicability = entry.namespaceApplicability.find(
    (candidate) => candidate.namespace === canonical,
  );
  if (!applicability) return null;
  const definition = definitions.find((candidate) => candidate.name === canonical);
  return {
    title: `${prefix}/`,
    semantics: definition?.semantics ?? "",
    identity: applicability.identity,
  };
}
