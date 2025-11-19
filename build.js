import * as esbuild from 'esbuild';
import cssModulesPlugin from 'esbuild-plugin-css-modules';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import { WebSocketServer } from 'ws';
import { execSync } from 'child_process';
import { globSync } from 'glob';

// Common build options
const commonOptions = {
  bundle: true,
  sourcemap: true,
  format: 'iife',
  platform: 'browser',
  target: 'es2015',
  minify: !process.argv.includes('--watch'),
};

// JavaScript build configuration
const jsBuildOptions = {
  ...commonOptions,
  entryPoints: ['src/main.mjs'],
  outfile: 'public/bundle.mjs',
  loader: {
    '.mjs': 'jsx'
  },
  define: {
    'process.env.NODE_ENV': process.argv.includes('--watch') ? '"development"' : '"production"',
    'global': 'window',
  },
};

// CSS build configuration
const cssBuildOptions = {
  ...commonOptions,
  entryPoints: ['src/styles/index.css'],
  outfile: 'public/bundle.css',
  plugins: [cssModulesPlugin()],
  external: ['/assets/*'],
};

// Markdown to HTML build configuration
const markdownBuildOptions = {
  inputDir: 'assets',
  outputDir: 'public/assets',
};

const referenceDataFile = {
  src: path.join('assets', 'modulisp_reference_data.json'),
  dest: path.join('public', 'assets', 'modulisp_reference_data.json')
};

const wasmBundleFile = {
  src: path.join('src-useq', 'wasm', 'useq.js'),
  dest: path.join('public', 'wasm', 'useq.js')
};

let warnedMissingWasmBundle = false;

// WASM rebuild tracking
let isRebuildingWasm = false;
let wasmRebuildQueued = false;

/**
 * Get the most recent modification time of all C++ source files in src-useq/
 */
function getWasmSourceModTime() {
  const srcUseqDir = 'src-useq';

  if (!fs.existsSync(srcUseqDir)) {
    return null;
  }

  // Find all C++ source files
  const sourceFiles = globSync(`${srcUseqDir}/**/*.{cpp,h,hpp}`, {
    ignore: ['**/node_modules/**', '**/build/**', '**/dist/**']
  });

  if (sourceFiles.length === 0) {
    return null;
  }

  // Get the max modification time
  let maxMtime = 0;
  for (const file of sourceFiles) {
    try {
      const stats = fs.statSync(file);
      maxMtime = Math.max(maxMtime, stats.mtimeMs);
    } catch (error) {
      // Skip files that can't be read
      continue;
    }
  }

  return maxMtime;
}

/**
 * Check if WASM needs to be rebuilt by comparing source file timestamps
 */
function checkWasmNeedsRebuild() {
  // Check if output exists
  if (!fs.existsSync(wasmBundleFile.src)) {
    console.log('WASM bundle does not exist, rebuild needed');
    return true;
  }

  // Get source modification time
  const sourceMtime = getWasmSourceModTime();
  if (sourceMtime === null) {
    console.warn('Could not determine WASM source modification time');
    return false;
  }

  // Get output modification time
  const outputStats = fs.statSync(wasmBundleFile.src);
  const outputMtime = outputStats.mtimeMs;

  // Compare timestamps
  if (sourceMtime > outputMtime) {
    console.log('WASM sources newer than built output, rebuild needed');
    return true;
  }

  console.log('WASM is up to date');
  return false;
}

/**
 * Rebuild the WASM bundle by executing build_wasm.sh
 */
function rebuildWasm() {
  const buildScript = path.join('src-useq', 'scripts', 'build_wasm.sh');

  if (!fs.existsSync(buildScript)) {
    throw new Error(`WASM build script not found at ${buildScript}`);
  }

  console.log('Building WASM...');
  console.log('This may take a minute...');

  try {
    // Execute the build script from the src-useq directory
    execSync(`cd src-useq && ./scripts/build_wasm.sh`, {
      stdio: 'inherit',
      encoding: 'utf-8'
    });
    console.log('✓ WASM build complete');
    return true;
  } catch (error) {
    console.error('✗ WASM build failed:', error.message);
    throw error;
  }
}

/**
 * Check and rebuild WASM if needed (blocking)
 */
function ensureWasmIsBuilt() {
  if (checkWasmNeedsRebuild()) {
    rebuildWasm();
    return true;
  }
  return false;
}

/**
 * Debounced WASM rebuild for watch mode
 */
let wasmRebuildTimer = null;
function triggerWasmRebuild() {
  // Prevent concurrent rebuilds
  if (isRebuildingWasm) {
    wasmRebuildQueued = true;
    return;
  }

  // Debounce rapid file changes
  clearTimeout(wasmRebuildTimer);
  wasmRebuildTimer = setTimeout(() => {
    isRebuildingWasm = true;
    wasmRebuildQueued = false;

    try {
      rebuildWasm();
      copyUseqWasmBundle();
    } catch (error) {
      console.error('WASM rebuild failed in watch mode:', error);
    } finally {
      isRebuildingWasm = false;

      // If another rebuild was queued, trigger it
      if (wasmRebuildQueued) {
        triggerWasmRebuild();
      }
    }
  }, 500); // 500ms debounce
}

/**
 * Watch C++ source files and trigger WASM rebuild on changes
 */
function watchWasmSources() {
  const srcUseqDir = 'src-useq';

  if (!fs.existsSync(srcUseqDir)) {
    console.warn(`src-useq directory not found, skipping WASM source watch`);
    return;
  }

  // Watch for C++ file changes
  const sourcePattern = `${srcUseqDir}/**/*.{cpp,h,hpp}`;

  console.log('Watching C++ source files for WASM rebuild...');

  // Use recursive watch on key directories
  const watchDirs = [
    path.join(srcUseqDir, 'wasm'),
    path.join(srcUseqDir, 'uSEQ', 'src', 'modulisp'),
    path.join(srcUseqDir, 'uSEQ', 'src', 'utils'),
  ].filter(dir => fs.existsSync(dir));

  watchDirs.forEach(dir => {
    fs.watch(dir, { recursive: true }, (eventType, filename) => {
      if (!filename) return;

      const ext = path.extname(filename);
      if (['.cpp', '.h', '.hpp'].includes(ext)) {
        console.log(`C++ source changed: ${filename}`);
        triggerWasmRebuild();
      }
    });
  });
}

function ensureDirectoryExists(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function buildMarkdown() {
  const inputDir = markdownBuildOptions.inputDir;
  const outputDir = markdownBuildOptions.outputDir;

  fs.readdirSync(inputDir).forEach(file => {
    if (path.extname(file) === '.md') {
      const filePath = path.join(inputDir, file);
      const outputFilePath = path.join(outputDir, file.replace('.md', '.html'));

      const markdownContent = fs.readFileSync(filePath, 'utf-8');
      const htmlContent = marked(markdownContent);

      fs.writeFileSync(outputFilePath, htmlContent);
      console.log(`Compiled ${file} to ${outputFilePath}`);
    }
  });
}

function copyReferenceData() {
  try {
    ensureDirectoryExists(path.dirname(referenceDataFile.dest));
    fs.copyFileSync(referenceDataFile.src, referenceDataFile.dest);
    console.log(`Copied ${referenceDataFile.src} to ${referenceDataFile.dest}`);
  } catch (error) {
    console.error(`Failed to copy ${referenceDataFile.src}:`, error);
  }
}

function copyUseqWasmBundle() {
  if (!fs.existsSync(wasmBundleFile.src)) {
    if (!warnedMissingWasmBundle) {
      console.warn(`uSEQ WASM bundle not found at ${wasmBundleFile.src}. Run src-useq/scripts/build_wasm.sh to generate it.`);
      warnedMissingWasmBundle = true;
    }
    return;
  }

  warnedMissingWasmBundle = false;

  try {
    ensureDirectoryExists(path.dirname(wasmBundleFile.dest));
    fs.copyFileSync(wasmBundleFile.src, wasmBundleFile.dest);
    console.log(`Copied ${wasmBundleFile.src} to ${wasmBundleFile.dest}`);
  } catch (error) {
    console.error(`Failed to copy ${wasmBundleFile.src}:`, error);
  }
}

async function build() {
  try {
    // Ensure WASM is built before starting (blocking)
    console.log('Checking WASM build status...');
    ensureWasmIsBuilt();

    if (process.argv.includes('--watch')) {
      // Watch mode with WebSocket for hot reload
      const wss = new WebSocketServer({ port: 8080 });
      const clients = new Set();

      wss.on('connection', (ws) => {
        clients.add(ws);
        console.log('Client connected for hot reload');
        
        ws.on('close', () => {
          clients.delete(ws);
          console.log('Client disconnected');
        });
      });

      // Create a plugin to notify clients on CSS rebuild
      const hotReloadPlugin = {
        name: 'hot-reload',
        setup(build) {
          build.onEnd(result => {
            if (result.errors.length === 0) {
              // Notify all connected clients
              clients.forEach(client => {
                if (client.readyState === 1) { // WebSocket.OPEN
                  client.send(JSON.stringify({ type: 'css-update' }));
                }
              });
              console.log('CSS updated, notified clients');
            }
          });
        }
      };

      // Add hot reload plugin to CSS build
      const cssWithHotReload = {
        ...cssBuildOptions,
        plugins: [...cssBuildOptions.plugins, hotReloadPlugin]
      };

      const jsContext = await esbuild.context(jsBuildOptions);
      const cssContext = await esbuild.context(cssWithHotReload);

      buildMarkdown();
      copyReferenceData();
      copyUseqWasmBundle();

      // Watch C++ source files for WASM rebuild
      watchWasmSources();

      // Watch for markdown changes
      fs.watch(markdownBuildOptions.inputDir, (eventType, filename) => {
        if (!filename) {
          return;
        }

        if (path.extname(filename) === '.md') {
          buildMarkdown();
        }

        if (filename === path.basename(referenceDataFile.src)) {
          copyReferenceData();
        }
      });

      fs.watch(path.dirname(wasmBundleFile.src), (eventType, filename) => {
        if (!filename) {
          return;
        }

        if (filename === path.basename(wasmBundleFile.src)) {
          copyUseqWasmBundle();
        }
      });

      await Promise.all([
        jsContext.watch(),
        cssContext.watch()
      ]);
      
      console.log('Watching for changes...');
      console.log('Hot reload WebSocket server running on ws://localhost:8080');
    } else {
      // Single build
      await Promise.all([
        esbuild.build(jsBuildOptions),
        esbuild.build(cssBuildOptions)
      ]);
      buildMarkdown();
      copyReferenceData();
      copyUseqWasmBundle();
      console.log('Build complete');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
