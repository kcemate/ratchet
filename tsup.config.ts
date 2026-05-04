import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  target: "node18",
  outDir: "dist",
  clean: true,
  dts: true,
  sourcemap: true,
  shims: true,
  external: [
    "typescript",
    "better-sqlite3",
    "cors",
    "drizzle-orm",
    "express",
    "express-rate-limit",
    "helmet",
    "puppeteer",
  ],
});
