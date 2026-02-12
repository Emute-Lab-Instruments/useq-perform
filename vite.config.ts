/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig({
  plugins: [solid()],
  build: {
    target: "es2020",
    outDir: "public/solid-dist",
    rollupOptions: {
      input: {
        // Legacy entry point (replaces esbuild bundle)
        'bundle': 'src/main.mjs',
        // Entry points for each island
        'test-island': 'src-solid/islands/test-island.tsx',
        'double-radial-menu': 'src-solid/islands/double-radial-menu.tsx',
        'transport-toolbar': 'src-solid/islands/transport-toolbar.tsx',
        'main-toolbar': 'src-solid/islands/main-toolbar.tsx',
        'settings-panel': 'src-solid/islands/settings-panel.tsx',
        'help-panel': 'src-solid/islands/help-panel.tsx',
        'console-panel': 'src-solid/islands/console-panel.tsx',
        'picker-menu': 'src-solid/islands/picker-menu.tsx',
        'modal': 'src-solid/islands/modal.tsx',
        'snippets-panel': 'src-solid/islands/snippets-panel.tsx'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js',
        assetFileNames: '[name][extname]'
      }
    }
  },
  root: '.',
  publicDir: false // Don't copy public dir since we're building into it
  ,
  test: {
    projects: [
      {
        extends: true,
        plugins: [
          // The plugin will run tests for the stories defined in your Storybook config
          // See options at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon#storybooktest
          storybookTest({
            configDir: path.join(dirname, '.storybook')
          })
        ],
        test: {
          name: 'storybook',
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({}),
            instances: [{
              browser: 'chromium'
            }]
          },
          setupFiles: ['.storybook/vitest.setup.ts']
        }
      },
      {
        plugins: [solid()],
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src-solid/**/*.test.tsx', 'src-solid/**/*.test.ts'],
          globals: true,
          setupFiles: []
        }
      }
    ]
  }
});