#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

const allowedTargets = new Map([
  ["musicthing", "Music Thing Modular"],
  ["hardware_v0_2", "uSEQ hardware v0.2"],
  ["hardware_v1_0", "uSEQ hardware v1.0"],
  ["expander_aout08_v0_1", "uSEQ 8-output expander v0.1"],
]);

function fail(message) {
  console.error(message);
  process.exit(1);
}

const args = process.argv.slice(2);
let version = "";
let notes = "";
const inputs = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--version") version = args[++i] ?? "";
  else if (args[i] === "--notes") notes = args[++i] ?? "";
  else if (args[i] === "--artifact") inputs.push(args[++i] ?? "");
  else fail(`Unknown argument: ${args[i]}`);
}

if (!/^1\.2\.0-beta\.[1-9]\d*$/.test(version)) {
  fail("--version must use canonical SemVer, for example 1.2.0-beta.1");
}
if (inputs.length === 0) {
  fail("Provide at least one --artifact target=/absolute/or/relative/file.uf2");
}

const releaseDir = resolve("public", "firmware", "beta", version);
mkdirSync(releaseDir, { recursive: true });

const seen = new Set();
const artifacts = inputs.map((input) => {
  const equals = input.indexOf("=");
  if (equals < 1) fail(`Invalid --artifact value: ${input}`);
  const target = input.slice(0, equals);
  const source = resolve(input.slice(equals + 1));
  if (!allowedTargets.has(target)) fail(`Unknown firmware target: ${target}`);
  if (seen.has(target)) fail(`Duplicate firmware target: ${target}`);
  seen.add(target);
  if (!source.endsWith(".uf2")) fail(`Artifact must be a .uf2 file: ${source}`);

  const filename = `${target}.uf2`;
  const destination = resolve(releaseDir, filename);
  copyFileSync(source, destination);
  const bytes = readFileSync(destination);
  return {
    target,
    label: allowedTargets.get(target),
    url: `/firmware/beta/${version}/${filename}`,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    size: statSync(destination).size,
  };
});

let notesUrl;
if (notes) {
  const source = resolve(notes);
  const destination = resolve(releaseDir, basename(source));
  mkdirSync(dirname(destination), { recursive: true });
  copyFileSync(source, destination);
  notesUrl = `/firmware/beta/${version}/${basename(source)}`;
}

const manifest = {
  schemaVersion: 1,
  channel: "beta",
  version,
  publishedAt: new Date().toISOString(),
  ...(notesUrl ? { notesUrl } : {}),
  artifacts,
};
const manifestPath = resolve("public", "firmware", "beta", "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Prepared ${version}: ${artifacts.length} artifact(s)`);
console.log(`Manifest: ${manifestPath}`);
