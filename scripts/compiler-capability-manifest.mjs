import { createHash } from 'node:crypto';
import fs from 'node:fs';

export const COMPILER_CAPABILITY_MANIFEST_SCHEMA =
  'useq.compiler-capabilities/v1';

const REQUIRED_COMPILER_ARTIFACTS = Object.freeze([
  'wasm/useq.js',
  'wasm/useq.wasm',
]);

function fail(message) {
  throw new Error(`Invalid uSEQ compiler capability manifest: ${message}`);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function sha256File(filePath) {
  const digest = createHash('sha256');
  digest.update(fs.readFileSync(filePath));
  return digest.digest('hex');
}

/**
 * Validate one compiler manifest against the exact interpreter JS/WASM bytes.
 *
 * This contract intentionally covers only the ModuLisp compiler/interpreter
 * bundle recorded by `useq.compiler-capabilities/v1`. NodeDef modules are
 * separate build artefacts with separate runtime metadata validation.
 */
export function verifyCompilerCapabilityManifest({
  manifestPath,
  jsPath,
  wasmPath,
  expectedGitCommit,
}) {
  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    fail(`cannot parse ${manifestPath}: ${error.message}`);
  }

  if (!isRecord(manifest) || manifest.schema !== COMPILER_CAPABILITY_MANIFEST_SCHEMA) {
    fail(`unsupported schema in ${manifestPath}`);
  }
  if (!isRecord(manifest.source)) {
    fail('missing source record');
  }
  if (!/^[0-9a-f]{40}$/.test(manifest.source.git_commit ?? '')) {
    fail('source.git_commit is not a full Git object id');
  }
  if (manifest.source.git_dirty !== false) {
    fail('source build was dirty');
  }
  if (!Array.isArray(manifest.source.git_dirty_entries) ||
      manifest.source.git_dirty_entries.length !== 0) {
    fail('source.git_dirty_entries is not empty');
  }
  if (expectedGitCommit !== undefined &&
      manifest.source.git_commit !== expectedGitCommit) {
    fail(
      `source commit ${manifest.source.git_commit} does not match ` +
        `checked-out compiler ${expectedGitCommit}`,
    );
  }

  const synthAbi = manifest.capabilities?.hard_limits
    ?.synth_artifact_abi_version;
  if (synthAbi !== 2) {
    fail(`synth artifact ABI ${String(synthAbi)} is incompatible; expected 2`);
  }
  if (!isRecord(manifest.artifacts)) {
    fail('missing artifacts record');
  }

  const paths = {
    'wasm/useq.js': jsPath,
    'wasm/useq.wasm': wasmPath,
  };
  for (const key of REQUIRED_COMPILER_ARTIFACTS) {
    const artifact = manifest.artifacts[key];
    if (!isRecord(artifact) ||
        !Number.isSafeInteger(artifact.bytes) || artifact.bytes <= 0 ||
        !/^[0-9a-f]{64}$/.test(artifact.sha256 ?? '')) {
      fail(`malformed artifact record ${key}`);
    }
    const filePath = paths[key];
    if (!fs.existsSync(filePath)) {
      fail(`missing artifact ${filePath}`);
    }
    const actualBytes = fs.statSync(filePath).size;
    const actualSha256 = sha256File(filePath);
    if (actualBytes !== artifact.bytes || actualSha256 !== artifact.sha256) {
      fail(
        `${key} byte identity mismatch: manifest=${artifact.bytes}/` +
          `${artifact.sha256}, actual=${actualBytes}/${actualSha256}`,
      );
    }
  }

  const maxWasmBytes = manifest.gates?.max_wasm_bytes;
  if (!Number.isSafeInteger(maxWasmBytes) || maxWasmBytes <= 0 ||
      fs.statSync(wasmPath).size > maxWasmBytes) {
    fail('WASM size gate is missing, invalid, or exceeded');
  }

  return manifest;
}
