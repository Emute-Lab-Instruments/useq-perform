import type { AppConfigDocument } from "./schema";

export interface ConfigurationValidation {
  valid: boolean;
  errors: string[];
}

/** Validate the required import-document shape and bounded scalar fields. */
export function validateConfiguration(config: unknown): ConfigurationValidation {
  const errors: string[] = [];
  if (!config || typeof config !== "object") {
    return { valid: false, errors: ["Configuration is null or undefined"] };
  }

  const document = config as Partial<AppConfigDocument>;
  if (!document.version) errors.push("Missing version field");
  if (!document.user) {
    errors.push("Missing user field");
  } else {
    for (const section of ["editor", "storage", "ui", "visualisation"] as const) {
      if (!document.user[section]) {
        errors.push(`Missing user.${section} field`);
      }
    }
  }

  const fontSize = document.user?.editor?.fontSize;
  if (
    fontSize != null &&
    (typeof fontSize !== "number" || fontSize < 8 || fontSize > 32)
  ) {
    errors.push("user.editor.fontSize must be a number between 8 and 32");
  }

  const autoSaveInterval = document.user?.storage?.autoSaveInterval;
  if (
    autoSaveInterval != null &&
    (typeof autoSaveInterval !== "number" || autoSaveInterval < 1000)
  ) {
    errors.push("user.storage.autoSaveInterval must be a number >= 1000");
  }

  if (
    document.user?.visualisation &&
    document.user.visualisation.windowDuration == null
  ) {
    errors.push("user.visualisation.windowDuration is required");
  }

  return { valid: errors.length === 0, errors };
}

function describeChange(
  label: string,
  current: unknown,
  incoming: unknown,
  suffix = "",
): string | null {
  return current === incoming
    ? null
    : `${label}: ${String(current)}${suffix} → ${String(incoming)}${suffix}`;
}

/** Return the user-facing subset of changes shown by config import review. */
export function getConfigurationDiff(
  current: Partial<AppConfigDocument>,
  incoming: Partial<AppConfigDocument>,
): string[] {
  return [
    describeChange(
      "Theme",
      current.user?.editor?.theme,
      incoming.user?.editor?.theme,
    ),
    describeChange(
      "Font Size",
      current.user?.editor?.fontSize,
      incoming.user?.editor?.fontSize,
    ),
    describeChange(
      "Visual Window",
      current.user?.visualisation?.windowDuration,
      incoming.user?.visualisation?.windowDuration,
      "s",
    ),
    describeChange(
      "Line Width",
      current.user?.visualisation?.lineWidth,
      incoming.user?.visualisation?.lineWidth,
      "px",
    ),
  ].filter((difference): difference is string => difference !== null);
}
