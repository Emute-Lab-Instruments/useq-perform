import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SERVED_BUNDLE_MANIFEST_SCHEMA = 'useq.served-bundle/v1';
const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fail(message) {
  throw new Error(`Invalid uSEQ served-bundle manifest: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function sortForCanonicalJson(value) {
  if (Array.isArray(value)) return value.map(sortForCanonicalJson);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortForCanonicalJson(value[key])]),
  );
}

/** Deterministic JSON representation used both on disk and for descriptor IDs. */
export function canonicalJson(value) {
  return `${JSON.stringify(sortForCanonicalJson(value), null, 2)}\n`;
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function artifactRecord(filePath) {
  if (!fs.existsSync(filePath)) fail(`missing artifact ${filePath}`);
  const bytes = fs.readFileSync(filePath);
  if (bytes.byteLength === 0) fail(`empty artifact ${filePath}`);
  return Object.freeze({
    bytes: bytes.byteLength,
    sha256: sha256Bytes(bytes),
  });
}

function applicationSourceState() {
  const runGit = (args) => execFileSync('git', ['-C', APP_ROOT, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  const dirtyEntries = runGit([
    'status', '--porcelain', '--untracked-files=no',
  ]).split('\n').filter(Boolean).sort();
  return {
    git_commit: runGit(['rev-parse', 'HEAD']),
    git_dirty: dirtyEntries.length > 0,
    git_dirty_entries: dirtyEntries,
  };
}

/** Read the module-owned NodeDef descriptor directly from its WASM bytes. */
export function readNodeDefDescriptorFromWasm(nodeDefPath) {
  const bytes = fs.readFileSync(nodeDefPath);
  let module;
  let instance;
  const memory = new WebAssembly.Memory({ initial: 256, maximum: 256 });
  try {
    module = new WebAssembly.Module(bytes);
    instance = new WebAssembly.Instance(module, { env: { memory } });
  } catch (error) {
    fail(`cannot instantiate NodeDef ${nodeDefPath}: ${error.message}`);
  }
  const exports = instance.exports;
  if (typeof exports._initialize === 'function') exports._initialize();
  const registryJson =
    exports.osc_sine_registry_json ?? exports._osc_sine_registry_json;
  if (typeof registryJson !== 'function') {
    fail(`NodeDef ${nodeDefPath} has no osc_sine_registry_json export`);
  }
  const pointer = registryJson();
  if (!Number.isSafeInteger(pointer) || pointer < 0 || pointer >= memory.buffer.byteLength) {
    fail(`NodeDef ${nodeDefPath} returned invalid registry pointer ${String(pointer)}`);
  }
  const view = new Uint8Array(
    memory.buffer,
    pointer,
    Math.min(64 * 1024, memory.buffer.byteLength - pointer),
  );
  const end = view.indexOf(0);
  if (end <= 0) fail(`NodeDef ${nodeDefPath} returned an unterminated registry`);
  let descriptor;
  try {
    descriptor = JSON.parse(new TextDecoder('utf-8').decode(view.subarray(0, end)));
  } catch (error) {
    fail(`NodeDef ${nodeDefPath} returned malformed registry JSON: ${error.message}`);
  }
  if (!isRecord(descriptor) || typeof descriptor.name !== 'string' ||
      !Number.isSafeInteger(descriptor.version) || descriptor.version <= 0) {
    fail(`NodeDef ${nodeDefPath} registry lacks a valid name/version identity`);
  }
  return descriptor;
}

/** Recompute the complete unsigned identity record from served bytes. */
export function buildServedBundleManifest({
  compilerManifestPath,
  jsPath,
  wasmPath,
  nodeDefPath,
  workletPath,
}) {
  let compilerManifest;
  try {
    compilerManifest = JSON.parse(fs.readFileSync(compilerManifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot parse compiler manifest ${compilerManifestPath}: ${error.message}`);
  }
  if (!isRecord(compilerManifest) ||
      compilerManifest.schema !== 'useq.compiler-capabilities/v1' ||
      !/^[0-9a-f]{40}$/.test(compilerManifest.source?.git_commit ?? '')) {
    fail('compiler manifest has no supported schema/full source commit');
  }

  const descriptor = readNodeDefDescriptorFromWasm(nodeDefPath);
  const identity = `${descriptor.name}@${descriptor.version}`;
  return {
    schema: SERVED_BUNDLE_MANIFEST_SCHEMA,
    profile_ownership: {
      profile: 'application-served-bundle',
      owns: [
        'application_source_identity',
        'compiler_manifest_binding',
        'interpreter_served_artifacts',
        'node_def_descriptors_and_artifacts',
        'sample_rate_and_render_quantum',
        'audio_activation_and_worklet',
      ],
      field_dispositions: {
        compiler_source_build_and_capabilities: {
          status: 'not-applicable',
          owner_profile: 'compiler-interpreter',
        },
        target_firmware_artifacts_and_resources: {
          status: 'not-applicable',
          owner_profile: 'firmware-build',
        },
      },
    },
    trust: {
      authenticated: false,
      scope: 'exact-byte-identity-only',
      warning: 'Unsigned build record; it does not prove publisher or source authenticity.',
    },
    application: applicationSourceState(),
    compiler: {
      capability_manifest_artifact: 'wasm/useq-capabilities.json',
      capability_manifest_schema: compilerManifest.schema,
      source_git_commit: compilerManifest.source.git_commit,
    },
    runtime_contract: {
      activation_epoch: {
        encoding: 'uint32-le',
        field_width_bits: 32,
        reserved_values: [0],
        minimum_issued: 1,
        maximum_issued: 0xffff_ffff,
        exhaustion: 'terminal-error-before-reuse',
      },
    },
    artifacts: {
      'wasm/useq-capabilities.json': artifactRecord(compilerManifestPath),
      'wasm/useq.js': artifactRecord(jsPath),
      'wasm/useq.wasm': artifactRecord(wasmPath),
      'wasm/osc_sine.wasm': artifactRecord(nodeDefPath),
      'wasm/synthesisWorklet.js': artifactRecord(workletPath),
    },
    node_defs: [{
      artifact: 'wasm/osc_sine.wasm',
      identity,
      descriptor,
      descriptor_sha256: sha256Bytes(Buffer.from(canonicalJson(descriptor), 'utf8')),
    }],
  };
}

export function writeServedBundleManifest({ outputPath, ...inputs }) {
  const manifest = buildServedBundleManifest(inputs);
  fs.writeFileSync(outputPath, canonicalJson(manifest));
  return manifest;
}

/** Fail unless an existing record exactly matches a fresh recomputation. */
export function verifyServedBundleManifest({ manifestPath, ...inputs }) {
  let actual;
  try {
    actual = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${manifestPath}: ${error.message}`);
  }
  if (!isRecord(actual) || actual.schema !== SERVED_BUNDLE_MANIFEST_SCHEMA) {
    fail(`unsupported schema in ${manifestPath}`);
  }
  if (actual.trust?.authenticated !== false ||
      actual.trust?.scope !== 'exact-byte-identity-only') {
    fail('trust boundary must explicitly remain unauthenticated');
  }
  const expected = buildServedBundleManifest(inputs);
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(
      'record does not match the current served bytes, descriptor identity, ' +
        'or runtime contract',
    );
  }
  return actual;
}
