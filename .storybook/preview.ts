import type { Preview } from 'storybook-solidjs-vite';
import '../src/ui/styles/index.css';

const preview: Preview = {
  parameters: {
    layout: 'fullscreen',
    a11y: { test: 'todo' },
  },
};

export default preview;
