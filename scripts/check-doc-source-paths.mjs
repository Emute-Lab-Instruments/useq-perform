#!/usr/bin/env node

/**
 * Fail when current orientation docs name a source file that no
 * longer exists. Archival history and generated documentation are excluded on
 * purpose: this gate protects the documents a new contributor is told to
 * trust, not historical evidence.
 */

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const sourceExtensions =
  /\.(?:c|cc|clj|cljs|cpp|css|h|hpp|html|js|json|mjs|ts|tsx|yaml|yml)$/;

const documents = [
  "README.md",
  "MAP.md",
  "ALIGNMENT.md",
  "docs/REPO_MAP.md",
  "docs/GLOSSARY.md",
  "src-useq/MAP.md",
  "src-useq/CLAUDE.md",
];

const failures = [];
for (const document of documents) {
  const absoluteDocument = join(root, document);
  if (!existsSync(absoluteDocument)) continue;

  const lines = readFileSync(absoluteDocument, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const match of line.matchAll(/`((?:src|src-useq)\/[^`]+)`/g)) {
      const rawPath = match[1]
        .replace(/[#:]L?\d+(?:-L?\d+)?$/, "")
        .replace(/[),.;]+$/, "");
      if (
        !sourceExtensions.test(rawPath) ||
        /[*{}<>]/.test(rawPath) ||
        rawPath.includes(" ")
      ) {
        continue;
      }
      if (!existsSync(join(root, rawPath))) {
        failures.push(`${document}:${index + 1}: ${rawPath}`);
      }
    }
  });
}

if (failures.length > 0) {
  console.error("Current documentation refers to missing source files:\n");
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation source paths verified (${documents.length} files).`);
}
