import { defineConfig } from "vite";
import solidPlugin from "vite-plugin-solid";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: resolve(__dirname),
  plugins: [solidPlugin()],
  resolve: {
    alias: {
      "@src": resolve(__dirname, "../src"),
    },
  },
  server: {
    port: 5555,
  },
  build: {
    outDir: resolve(__dirname, "dist"),
  },
});
