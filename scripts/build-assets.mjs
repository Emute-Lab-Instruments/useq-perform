/**
 * Build script for non-JS/CSS assets:
 *   - Markdown -> HTML compilation
 *   - Reference data copy
 *   - WASM bundle copy
 *   - Synthesis AudioWorklet processor bundle (synthesisWorklet.ts → JS)
 *   - Engine Ledger assets: conformance-witness index + language spec corpus
 *
 * Usage:
 *   node scripts/build-assets.mjs           # One-shot build
 *   node scripts/build-assets.mjs --watch   # Watch mode
 */

import fs from 'fs';
import path from 'path';
import { Marked } from 'marked';
import * as esbuild from 'esbuild';
import { buildWitnessIndex, CORPUS_DIR } from './harvest-witnesses.mjs';
import { buildSpecCorpus, SPECS_DIR } from './harvest-specs.mjs';

// --- Configuration ---

const markdownConfig = {
  inputDir: 'assets',
  outputDir: 'public/assets',
};

const referenceDataFile = {
  src: path.join('assets', 'modulisp_reference_data.json'),
  dest: path.join('public', 'assets', 'modulisp_reference_data.json'),
};

const wasmBundleFile = {
  src: path.join('src-useq', 'wasm', 'useq.js'),
  dest: path.join('public', 'wasm', 'useq.js'),
};

// Synthesis AudioWorklet processor — bundled from TypeScript source into
// a single self-contained JS file emitted at public/wasm/synthesisWorklet.js.
// The worklet scope cannot resolve ES module imports from the app bundle,
// so the build step inlines every dependency (workletCore, ABI contract,
// NodeDef adapter types) into the output file.
const synthesisWorkletFile = {
  src: path.join('src', 'audio', 'synthesisWorklet.ts'),
  dest: path.join('public', 'wasm', 'synthesisWorklet.js'),
};

const wasmBinaryFile = {
  src: path.join('src-useq', 'wasm', 'useq.wasm'),
  dest: path.join('public', 'wasm', 'useq.wasm'),
};

// osc/sine NodeDef WASM — a SEPARATE build target from the interpreter
// (VAL-DSP-015). The synthesis service loads this artefact from
// /wasm/osc_sine.wasm via the browser NodeDef module loader.
const oscSineNodedefFile = {
  src: path.join('src-useq', 'wasm', 'osc_sine.wasm'),
  dest: path.join('public', 'wasm', 'osc_sine.wasm'),
};

const fontFiles = [
  'IBMPlexMono-Regular.woff2',
  'IBMPlexMono-Medium.woff2',
  'IBMPlexMono-SemiBold.woff2',
].map((file) => ({
  src: path.join('assets', 'fonts', 'ibm-plex-mono', file),
  dest: path.join('public', 'assets', 'fonts', 'ibm-plex-mono', file),
}));

// --- Helpers ---

function ensureDirectoryExists(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function copyRequiredArtifact({ src, dest, label, command }) {
  if (!fs.existsSync(src)) {
    throw new Error(
      `Required ${label} not found at ${src}. ` +
        `Run ${command} before building app assets.`,
    );
  }

  ensureDirectoryExists(path.dirname(dest));
  fs.copyFileSync(src, dest);

  if (!fs.existsSync(dest) || fs.statSync(dest).size === 0) {
    throw new Error(`Required ${label} was not copied to ${dest}.`);
  }

  console.log(`Copied ${src} -> ${dest}`);
}

// --- Build Tasks ---

function buildMarkdown() {
  const { inputDir, outputDir } = markdownConfig;

  if (!fs.existsSync(inputDir)) {
    console.warn(`Markdown input directory not found: ${inputDir}`);
    return;
  }

  ensureDirectoryExists(outputDir);

  fs.readdirSync(inputDir).forEach((file) => {
    if (path.extname(file) === '.md') {
      const filePath = path.join(inputDir, file);
      const outputFilePath = path.join(outputDir, file.replace('.md', '.html'));

      const markdownContent = fs.readFileSync(filePath, 'utf-8');
      const used = new Set();

      const md = new Marked().use({
        renderer: {
          heading({ text, depth }) {
            const raw = text.replace(/<[^>]*>/g, '');
            const slug = raw.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s]+/g, '-');
            let id = slug;
            if (used.has(id)) {
              let n = 1;
              while (used.has(id + '-' + n)) n++;
              id += '-' + n;
            }
            used.add(id);
            return `<h${depth} id="${id}">${text}</h${depth}>\n`;
          },
        },
      });

      const htmlContent = md.parse(markdownContent);

      fs.writeFileSync(outputFilePath, htmlContent);
      console.log(`Compiled ${file} -> ${outputFilePath}`);
    }
  });
}

function copyReferenceData() {
  try {
    ensureDirectoryExists(path.dirname(referenceDataFile.dest));
    fs.copyFileSync(referenceDataFile.src, referenceDataFile.dest);
    console.log(`Copied ${referenceDataFile.src} -> ${referenceDataFile.dest}`);
  } catch (error) {
    console.error(`Failed to copy ${referenceDataFile.src}:`, error.message);
  }
}

function copyUseqWasmBundle() {
  // These are all mandatory runtime artifacts. Keep each check independent:
  // the NodeDef is a separate build target and must not be hidden behind the
  // interpreter bundle check.
  copyRequiredArtifact({
    src: wasmBundleFile.src,
    dest: wasmBundleFile.dest,
    label: 'uSEQ WASM JavaScript loader',
    command: 'npm run build:wasm',
  });

  copyRequiredArtifact({
    src: wasmBinaryFile.src,
    dest: wasmBinaryFile.dest,
    label: 'uSEQ WASM binary',
    command: 'npm run build:wasm',
  });

  copyRequiredArtifact({
    src: oscSineNodedefFile.src,
    dest: oscSineNodedefFile.dest,
    label: 'osc/sine NodeDef WASM artefact',
    command: 'npm run build:wasm',
  });
}

function copyFonts() {
  for (const font of fontFiles) {
    try {
      ensureDirectoryExists(path.dirname(font.dest));
      fs.copyFileSync(font.src, font.dest);
      console.log(`Copied ${font.src} -> ${font.dest}`);
    } catch (error) {
      console.error(`Failed to copy ${font.src}:`, error.message);
    }
  }
}

// --- Main ---

async function bundleSynthesisWorklet() {
  if (!fs.existsSync(synthesisWorkletFile.src)) {
    console.warn(
      `Synthesis worklet source not found at ${synthesisWorkletFile.src}. ` +
        'The synthesis engine will not be able to start audio.'
    );
    return;
  }

  try {
    ensureDirectoryExists(path.dirname(synthesisWorkletFile.dest));
    // Bundle the worklet processor into a single self-contained file.
    // The AudioWorkletGlobalScope cannot resolve ES module imports from
    // the app bundle, so every dependency is inlined.
    //
    // Format: iife — the worklet scope evaluates the script once and
    // expects `registerProcessor` to be called as a side effect.
    // Platform: browser — no Node.js shims.
    // Target: es2020 — matches the Vite build target.
    const result = await esbuild.build({
      entryPoints: [synthesisWorkletFile.src],
      bundle: true,
      format: 'iife',
      platform: 'browser',
      target: 'es2020',
      write: false,
      logLevel: 'silent',
    });

    const output = result.outputFiles[0];
    if (!output) {
      throw new Error('esbuild produced no output for the synthesis worklet');
    }
    fs.writeFileSync(synthesisWorkletFile.dest, output.text);
    console.log(`Bundled ${synthesisWorkletFile.src} -> ${synthesisWorkletFile.dest}`);
  } catch (error) {
    console.error(`Failed to bundle ${synthesisWorkletFile.src}:`, error.message);
  }
}

function buildAll() {
  console.log('Building assets...');
  buildMarkdown();
  copyReferenceData();
  copyUseqWasmBundle();
  copyFonts();
  // Engine Ledger assets (witnesses.md §3, engine-ledger.md §2). A witness
  // that cannot be indexed is drift by definition, so these throw on
  // validation failure rather than degrading silently.
  buildWitnessIndex();
  buildSpecCorpus();
  // The worklet bundle is async. buildAll returns a Promise that the
  // Vite build waits on via `npm run build:assets && vite build`.
  console.log('Assets build complete.');
  return bundleSynthesisWorklet();
}

function watchMode() {
  buildAll();

  let synthesisWorkletBuildTimer = null;
  const scheduleSynthesisWorkletBundle = () => {
    if (synthesisWorkletBuildTimer !== null) {
      clearTimeout(synthesisWorkletBuildTimer);
    }
    synthesisWorkletBuildTimer = setTimeout(() => {
      synthesisWorkletBuildTimer = null;
      bundleSynthesisWorklet();
    }, 50);
  };

  // Watch markdown & reference data
  if (fs.existsSync(markdownConfig.inputDir)) {
    fs.watch(markdownConfig.inputDir, (_eventType, filename) => {
      if (!filename) return;

      if (path.extname(filename) === '.md') {
        buildMarkdown();
      }

      if (filename === path.basename(referenceDataFile.src)) {
        copyReferenceData();
      }

      if (filename.endsWith('.woff2')) {
        copyFonts();
      }
    });
    console.log(`Watching ${markdownConfig.inputDir}/ for changes...`);
  }

  // Watch WASM bundle
  const wasmDir = path.dirname(wasmBundleFile.src);
  if (fs.existsSync(wasmDir)) {
    fs.watch(wasmDir, (_eventType, filename) => {
      if (!filename) return;
      if (filename === path.basename(wasmBundleFile.src)) {
        copyUseqWasmBundle();
      }
    });
    console.log(`Watching ${wasmDir}/ for WASM bundle changes...`);
  }

  // Watch every source imported by the self-contained synthesis worklet
  // bundle. fs.watch can emit several events for one save, so coalesce them
  // before invoking esbuild.
  const synthesisAudioDir = path.dirname(synthesisWorkletFile.src);
  if (fs.existsSync(synthesisAudioDir)) {
    fs.watch(synthesisAudioDir, (_eventType, filename) => {
      if (!filename) return;
      scheduleSynthesisWorkletBundle();
    });
    console.log(`Watching ${synthesisAudioDir}/ for synthesis worklet changes...`);
  }

  // Watch the language spec corpus and the conformance corpus so the Engine
  // Ledger assets stay in step with the submodule during development.
  for (const [dir, rebuild, label] of [
    [SPECS_DIR, buildSpecCorpus, 'language spec corpus'],
    [CORPUS_DIR, buildWitnessIndex, 'conformance corpus'],
  ]) {
    if (!fs.existsSync(dir)) continue;
    fs.watch(dir, { recursive: true }, (_eventType, filename) => {
      if (!filename) return;
      try {
        rebuild();
      } catch (error) {
        console.error(`Failed to rebuild ${label}:`, error.message);
      }
    });
    console.log(`Watching ${dir}/ for ${label} changes...`);
  }

  const synthesisContractFiles = [
    path.join('src', 'contracts', 'synthesisControlAbi.ts'),
    path.join('src', 'contracts', 'nodeDefRegistry.ts'),
  ];
  for (const sourceFile of synthesisContractFiles) {
    if (!fs.existsSync(sourceFile)) continue;
    fs.watch(sourceFile, (_eventType, filename) => {
      if (!filename) return;
      scheduleSynthesisWorkletBundle();
    });
    console.log(`Watching ${sourceFile} for synthesis worklet changes...`);
  }
}

if (process.argv.includes('--watch')) {
  watchMode();
} else {
  // buildAll returns a Promise (the worklet bundle is async). Wait on
  // it so the Vite build step runs only after the worklet script is in
  // place.
  const result = buildAll();
  if (result && typeof result.then === 'function') {
    result.catch((err) => {
      console.error('Asset build failed:', err);
      process.exitCode = 1;
    });
  }
}
