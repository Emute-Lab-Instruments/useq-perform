import * as esbuild from 'esbuild';
import cssModulesPlugin from 'esbuild-plugin-css-modules';
import fs from 'fs';
import path from 'path';
import { marked } from 'marked';
import { WebSocketServer } from 'ws';

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

async function build() {
  try {
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
      console.log('Build complete');
    }
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

build();
