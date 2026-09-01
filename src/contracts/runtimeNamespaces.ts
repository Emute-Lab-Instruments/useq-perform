/** Namespaces whose operators are implemented only by hardware profiles. */
export const HARDWARE_ONLY_NAMESPACES = Object.freeze(["nn"] as const);

const HARDWARE_ONLY_NAMESPACE_SET = new Set<string>(HARDWARE_ONLY_NAMESPACES);

function isDelimiter(character: string): boolean {
  return /[\s()[\]{}"',;]/.test(character);
}

/**
 * Detect a registered hardware-only qualified symbol in ModuLisp source.
 * Strings and line comments are skipped so data such as "nn/status" does not
 * suppress a legitimate WASM evaluation.
 */
export function usesHardwareOnlyNamespace(source: string): boolean {
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    if (character === ";") {
      while (index < source.length && source[index] !== "\n") index += 1;
      continue;
    }
    if (character === "\"") {
      index += 1;
      while (index < source.length) {
        if (source[index] === "\\") index += 2;
        else if (source[index++] === "\"") break;
      }
      continue;
    }
    if (isDelimiter(character)) {
      index += 1;
      continue;
    }

    const tokenStart = index;
    while (index < source.length && !isDelimiter(source[index])) index += 1;
    const token = source.slice(tokenStart, index);
    const slash = token.indexOf("/");
    if (slash > 0 && HARDWARE_ONLY_NAMESPACE_SET.has(token.slice(0, slash))) {
      return true;
    }
  }
  return false;
}
