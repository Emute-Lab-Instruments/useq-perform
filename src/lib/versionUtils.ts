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
  /** SemVer prerelease identifiers. Omitted for a stable release. */
  prerelease?: readonly string[];
  /** Build metadata is displayed but ignored for precedence. */
  build?: string;
}

export const parseVersionString = (version: unknown): Version | null => {
  if (!version || typeof version !== "string") return null;
  const trimmed = version.trim().replace(/^v/i, "");
  if (!trimmed) return null;
  const [withoutBuild, build] = trimmed.split("+", 2);
  const dashIndex = withoutBuild.indexOf("-");
  const core = dashIndex >= 0 ? withoutBuild.slice(0, dashIndex) : withoutBuild;
  const prereleaseText = dashIndex >= 0 ? withoutBuild.slice(dashIndex + 1) : "";
  const coreParts = core.split(".");
  if (coreParts.length > 3 || prereleaseText === "") {
    if (dashIndex >= 0) return null;
  }
  const [majorStr, minorStr = "0", patchStr = "0"] = coreParts;
  const major = parseInt(majorStr, 10);
  const minor = parseInt(minorStr, 10);
  const patch = parseInt(patchStr, 10);
  if (isNaN(major) || isNaN(minor)) return null;
  const normalizedPatch = isNaN(patch) ? 0 : patch;
  const prerelease = prereleaseText
    ? prereleaseText.split(".")
    : undefined;
  if (
    prerelease?.some((identifier) =>
      !identifier || !/^[0-9A-Za-z-]+$/.test(identifier)
    ) ||
    (build !== undefined && !/^[0-9A-Za-z.-]+$/.test(build))
  ) {
    return null;
  }
  const raw = `${major}.${minor}.${normalizedPatch}` +
    (prerelease ? `-${prerelease.join(".")}` : "") +
    (build ? `+${build}` : "");
  return {
    major,
    minor,
    patch: normalizedPatch,
    raw,
    ...(prerelease ? { prerelease } : {}),
    ...(build ? { build } : {}),
  };
};

export const compareVersions = (left: Version | null, right: Version | null): number => {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  if (left.major !== right.major) return left.major - right.major;
  if (left.minor !== right.minor) return left.minor - right.minor;
  if (left.patch !== right.patch) return left.patch - right.patch;

  const leftPre = left.prerelease ?? [];
  const rightPre = right.prerelease ?? [];
  if (leftPre.length === 0 && rightPre.length === 0) return 0;
  if (leftPre.length === 0) return 1;
  if (rightPre.length === 0) return -1;

  const length = Math.max(leftPre.length, rightPre.length);
  for (let i = 0; i < length; i += 1) {
    const l = leftPre[i];
    const r = rightPre[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    if (l === r) continue;
    const lNumeric = /^\d+$/.test(l);
    const rNumeric = /^\d+$/.test(r);
    if (lNumeric && rNumeric) return Number(l) - Number(r);
    if (lNumeric) return -1;
    if (rNumeric) return 1;
    return l.localeCompare(r);
  }
  return 0;
};
