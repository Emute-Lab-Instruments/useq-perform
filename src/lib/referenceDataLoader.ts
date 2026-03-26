import type { ReferenceEntry } from "../utils/referenceStore.ts";
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
    meta: {
      introduced: parseVersionString(r.introduced_in_version),
      changed: parseVersionString(r.changed_in_version),
    },
  };
};

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

export const loadReferenceDataFromCandidates = async (): Promise<unknown[]> => {
  const errors: string[] = [];

  for (const candidate of getReferenceDataCandidateUrls()) {
    try {
      const response = await fetch(candidate);
      if (!response.ok) {
        errors.push(`${candidate} -> ${response.status}`);
        continue;
      }

      const data = await response.json();
      if (!Array.isArray(data)) {
        errors.push(`${candidate} -> invalid payload`);
        continue;
      }

      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${candidate} -> ${message}`);
    }
  }

  throw new Error(`Unable to load documentation data (${errors.join("; ")})`);
};
