import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

const isDev = process.env.NODE_ENV === "development";
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const rendererRoot = path.resolve(projectRoot, "src/v2/renderer");

export default defineConfig({
  root: rendererRoot,
  plugins: [viteSingleFile()],
  build: {
    sourcemap: isDev ? "inline" : undefined,
    cssMinify: !isDev,
    minify: !isDev,
    target: "es2022",
    outDir: path.resolve(projectRoot, "dist/v2/renderer"),
    emptyOutDir: true,
    rollupOptions: {
      input: path.resolve(rendererRoot, "index.html"),
      output: {
        entryFileNames: "[name].js",
        assetFileNames: "[name][extname]",
      },
    },
  },
});
