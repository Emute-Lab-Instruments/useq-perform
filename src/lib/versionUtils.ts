/**
 * Pure version-string utilities shared by referenceStore and referenceDataLoader.
 *
 * Extracted so that referenceDataLoader (src/lib/) can use these without
 * importing referenceStore (src/utils/), which has side-effects at module
 * level (localStorage reads via solid-js/store).
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  raw: string;
}

export const parseVersionString = (version: unknown): Version | null => {
  if (!version || typeof version !== "string") return null;
  const trimmed = version.trim().replace(/^v/i, "");
  if (!trimmed) return null;
  const [majorStr, minorStr = "0", patchStr = "0"] = trimmed.split(".");
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);
  if (isNaN(major) || isNaN(minor)) return null;
  return { major, minor, patch: isNaN(patch) ? 0 : patch, raw: `${major}.${minor}.${isNaN(patch) ? 0 : patch}` };
};

export const compareVersions = (left: Version | null, right: Version | null): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  return left.patch - right.patch;
};
