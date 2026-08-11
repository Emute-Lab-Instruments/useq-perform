/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
import { viteFullAppHosting } from './scripts/viteFullAppHosting.mjs';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

/**
 * Cross-origin isolation headers required for SharedArrayBuffer, which the
 * synthesis engine needs for its audio control ring.
 *
 * Applied consistently to:
 *   - Vite dev server (`server.headers`)
 *   - Vite preview server (`preview.headers`)
 *   - port-5000 static server (`public/serve.json`)
 *
 * `COOP: same-origin` is the standards-required value that enables
 * `window.crossOriginIsolated === true`. `same-site` only relaxes same-site
 * popup relationships and does NOT enable cross-origin isolation, leaving
 * `SharedArrayBuffer` unavailable. Do not revert this to `same-site`.
 *
 * `COEP: credentialless` (rather than `require-corp`) keeps `?gist`/`?txt`
 * CORS-capable fetches working without forcing every cross-origin asset to
 * ship CORP headers, matching the deterministic URL behaviour required by
 * VAL-HOST-010.
 */
const CROSS_ORIGIN_ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
} as const;

// More info at: https://storybook.js.org/docs/next/writing-tests/integrations/vitest-addon
export default defineConfig(({ command }) => ({
  base: "./",
  plugins: [
    solid({
      ...(command === 'serve' && {
        babel: {
          plugins: [
            ['./plugins/babel-solid-label.cjs', { sourceRoot: '.' }],
          ],
        },
      }),
    }),
    // Serves the complete application entry and every runtime asset
    // (wasm/useq.js, wasm/useq.wasm, wasm/synthesisWorklet.js,
    // wasm/osc_sine.wasm, assets/**, solid-dist/bundle.{js,css}) under
    // the Vite dev and preview servers on port 5000 despite
    // publicDir:false. See scripts/viteFullAppHosting.mjs and Ergo
    // bug ab2f2d33. Required for VAL-HOST-001 and VAL-HOST-002.
    viteFullAppHosting(),
  ],
  build: {
    target: "es2020",
    outDir: "public/solid-dist",
    rollupOptions: {
      input: {
        // Single entry point for the entire application
        // Islands have been eliminated; adapters are imported directly
        'bundle': 'src/main.ts'
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
  server: {
    headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS },
  },
  preview: {
    headers: { ...CROSS_ORIGIN_ISOLATION_HEADERS },
  },
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
        resolve: {
          alias: {
            '@src': path.resolve(dirname, 'src'),
          },
        },
        test: {
          name: 'unit',
          environment: 'jsdom',
          include: ['src/**/*.test.tsx', 'src/**/*.test.ts', 'grammar-lab/**/*.test.ts', 'grammar-lab/**/*.test.tsx'],
          exclude: ['src/editors/extensions/__tests__/structure-pure.test.ts'],
          globals: true,
          // The path string contains 'jest-dom' so vite-plugin-solid does not
          // auto-inject @testing-library/jest-dom (which fails to resolve in
          // worktree setups where node_modules is symlinked). This file is
          // a no-op stub.
          setupFiles: ['./vitest.jest-dom.setup.ts'],
          testTimeout: 15000,
        }
      }
    ]
  }
}));
