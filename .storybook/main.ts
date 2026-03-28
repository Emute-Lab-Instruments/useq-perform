import type { StorybookConfig } from 'storybook-solidjs-vite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const config: StorybookConfig = {
  stories: [
    '../stories/**/*.stories.@(ts|tsx)',
  ],
  addons: [
    '@storybook/addon-vitest',
    '@storybook/addon-a11y',
    '@storybook/addon-docs',
  ],
  framework: 'storybook-solidjs-vite',
  staticDirs: ['../public'],
  viteFinal: async (config) => {
    config.resolve = config.resolve || {};
    config.resolve.alias = {
      ...config.resolve.alias as Record<string, string>,
      '@src': path.resolve(dirname, '../src'),
    };
    return config;
  },
};

export default config;
