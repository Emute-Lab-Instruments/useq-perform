import type {
  NamespaceApplicability,
  NamespaceDefinition,
  ReferenceEntry,
} from "../utils/referenceStore.ts";
import { parseVersionString } from "./versionUtils.ts";

/** Raw shape of a reference entry as loaded from JSON (before normalization). */
interface RawReferenceEntry {
  name?: unknown;
  aliases?: unknown;
  tags?: unknown;
  parameters?: unknown;
  examples?: unknown;
  introduced_in_version?: unknown;
  changed_in_version?: unknown;
  bare_identity?: unknown;
  namespace_applicability?: unknown;
  [key: string]: unknown;
}

/** Normalize a raw JSON entry into a typed ReferenceEntry. */
export const normalizeEntry = (raw: unknown): ReferenceEntry | null => {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as RawReferenceEntry;
  return {
    name: typeof r.name === "string" ? r.name : "",
    description: typeof r.description === "string" ? r.description : "",
    aliases: Array.isArray(r.aliases) ? (r.aliases as unknown[]).filter((a): a is string => typeof a === "string") : [],
    tags: Array.isArray(r.tags) ? (r.tags as unknown[]).filter((t): t is string => typeof t === "string") : [],
    parameters: Array.isArray(r.parameters) ? (r.parameters as unknown[]).map((p) =>
      typeof p === "string" ? { name: p, description: "" } : (p as { name: string; description: string })
    ) : [],
    examples: Array.isArray(r.examples) ? (r.examples as string[]) : [],
    bareIdentity: typeof r.bare_identity === "string" ? r.bare_identity : null,
    namespaceApplicability: normalizeApplicability(r.namespace_applicability),
    meta: {
      introduced: parseVersionString(r.introduced_in_version),
      changed: parseVersionString(r.changed_in_version),
    },
  };
};

function normalizeApplicability(raw: unknown): NamespaceApplicability[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (
      typeof value.namespace !== "string" ||
      typeof value.spelling !== "string" ||
      typeof value.identity !== "string"
    ) return [];
    return [{
      namespace: value.namespace,
      spelling: value.spelling,
      identity: value.identity,
    }];
  });
}

function normalizeNamespaces(raw: unknown): NamespaceDefinition[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const value = item as Record<string, unknown>;
    if (typeof value.name !== "string" || typeof value.semantics !== "string") return [];
    return [{
      name: value.name,
      longName: typeof value.long_name === "string" ? value.long_name : undefined,
      semantics: value.semantics,
    }];
  });
}

export interface ReferenceDataDocument {
  operators: unknown[];
  namespaces: NamespaceDefinition[];
}

const REFERENCE_DATA_IMPORT_META_PATHS = [
  "../../assets/modulisp_reference_data.json",
  "../assets/modulisp_reference_data.json",
  "./assets/modulisp_reference_data.json",
];

const REFERENCE_DATA_WINDOW_PATHS = [
  "assets/modulisp_reference_data.json",
  "/assets/modulisp_reference_data.json",
  "/dev/assets/modulisp_reference_data.json",
  "../assets/modulisp_reference_data.json",
];

export const getReferenceDataCandidateUrls = (): string[] => {
  const candidates = new Set<string>();
  const importMetaUrl = typeof import.meta !== "undefined" ? import.meta.url : null;
  const windowHref =
    typeof window !== "undefined" && window.location?.href
      ? window.location.href
      : null;

  REFERENCE_DATA_IMPORT_META_PATHS.forEach((path) => {
    if (!importMetaUrl) return;
    try {
      candidates.add(new URL(path, importMetaUrl).href);
    } catch {
      // Ignore invalid URL resolutions; other candidates may still work.
    }
  });

  REFERENCE_DATA_WINDOW_PATHS.forEach((path) => {
    if (!windowHref) return;
    try {
      candidates.add(new URL(path, windowHref).href);
    } catch {
      // Ignore invalid URL resolutions; other candidates may still work.
    }
  });

  return Array.from(candidates);
};

export const loadReferenceDocumentFromCandidates = async (): Promise<ReferenceDataDocument> => {
  const errors: string[] = [];

  for (const candidate of getReferenceDataCandidateUrls()) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) {
        errors.push(`${candidate} -> ${response.status}`);
        continue;
      }

      const data: unknown = await response.json();
      if (Array.isArray(data)) {
        return { operators: data, namespaces: [] };
      }
      if (!data || typeof data !== "object") {
        errors.push(`${candidate} -> invalid payload`);
        continue;
      }
      const document = data as Record<string, unknown>;
      if (!Array.isArray(document.operators)) {
        errors.push(`${candidate} -> invalid operator payload`);
        continue;
      }
      return {
        operators: document.operators,
        namespaces: normalizeNamespaces(document.namespaces),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate} -> ${message}`);
    }
  }

  throw new Error(`Unable to load documentation data (${errors.join("; ")})`);
};

export const loadReferenceDataFromCandidates = async (): Promise<unknown[]> =>
  (await loadReferenceDocumentFromCandidates()).operators;
