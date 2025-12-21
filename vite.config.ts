import { defineConfig } from "vite";
import solid from "vite-plugin-solid";

export default defineConfig({
  plugins: [solid()],
  build: { 
    target: "es2020",
    outDir: "public/solid-dist",
    rollupOptions: {
      input: {
        // Entry points for each island
        'test-island': 'src-solid/islands/test-island.tsx',
        'double-radial-menu': 'src-solid/islands/double-radial-menu.tsx',
        'transport-toolbar': 'src-solid/islands/transport-toolbar.tsx'
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name].js'
      }
    }
  },
  root: '.',
  publicDir: false // Don't copy public dir since we're building into it
});