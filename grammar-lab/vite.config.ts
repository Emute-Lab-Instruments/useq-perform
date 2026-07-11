import { defineConfig } from "vite";
import solid from "vite-plugin-solid";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  base: "./",
  publicDir: false,
  plugins: [solid()],
  server: {
    port: 5566,
  },
  build: {
    target: "es2020",
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
  },
});
