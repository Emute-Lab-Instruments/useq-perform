/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { storybookTest } from '@storybook/addon-vitest/vitest-plugin';
import { playwright } from '@vitest/browser-playwright';
const dirname = typeof __dirname !== 'undefined' ? __dirname : path.dirname(fileURLToPath(import.meta.url));

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
  ],
  build: {
    target: "es2020",
    outDir: "public/solid-dist",
    rollupOptions: {
      input: {
        // Single entry point for the entire application
        // Islands have been eliminated; adapters are imported directly
        'bundle': 'src/legacy/main.ts'
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
          include: ['src/**/*.test.tsx', 'src/**/*.test.ts'],
          exclude: ['src/legacy/editors/extensions/__tests__/**'],
          globals: true,
          setupFiles: []
        }
      }
    ]
  }
}));
