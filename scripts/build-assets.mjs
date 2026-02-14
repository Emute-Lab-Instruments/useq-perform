/**
 * Build script for non-JS/CSS assets:
 *   - Markdown -> HTML compilation
 *   - Reference data copy
 *   - WASM bundle copy
 *
 * Usage:
 *   node scripts/build-assets.mjs           # One-shot build
 *   node scripts/build-assets.mjs --watch   # Watch mode
 */

import fs from 'fs';
import path from 'path';
import { marked } from 'marked';

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

const fontFiles = [
  'IBMPlexMono-Regular.woff2',
  'IBMPlexMono-Medium.woff2',
  'IBMPlexMono-SemiBold.woff2',
].map((file) => ({
  src: path.join('assets', 'fonts', 'ibm-plex-mono', file),
  dest: path.join('public', 'assets', 'fonts', 'ibm-plex-mono', file),
}));

let warnedMissingWasmBundle = false;

// --- Helpers ---

function ensureDirectoryExists(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
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
      const htmlContent = marked(markdownContent);

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
  if (!fs.existsSync(wasmBundleFile.src)) {
    if (!warnedMissingWasmBundle) {
      console.warn(
        `uSEQ WASM bundle not found at ${wasmBundleFile.src}. ` +
          'Run src-useq/scripts/build_wasm.sh to generate it.'
      );
      warnedMissingWasmBundle = true;
    }
    return;
  }

  warnedMissingWasmBundle = false;

  try {
    ensureDirectoryExists(path.dirname(wasmBundleFile.dest));
    fs.copyFileSync(wasmBundleFile.src, wasmBundleFile.dest);
    console.log(`Copied ${wasmBundleFile.src} -> ${wasmBundleFile.dest}`);
  } catch (error) {
    console.error(`Failed to copy ${wasmBundleFile.src}:`, error.message);
  }
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

function buildAll() {
  console.log('Building assets...');
  buildMarkdown();
  copyReferenceData();
  copyUseqWasmBundle();
  copyFonts();
  console.log('Assets build complete.');
}

function watchMode() {
  buildAll();

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
}

if (process.argv.includes('--watch')) {
  watchMode();
} else {
  buildAll();
}
