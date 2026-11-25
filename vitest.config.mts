import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir =
  typeof import.meta.dirname === "string"
    ? import.meta.dirname
    : path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/config\/(.*)/, replacement: path.resolve(dir, "./config/$1") },
      { find: /^@\/(.*)/, replacement: path.resolve(dir, "./src/$1") },
    ],
  },
  test: {
    environment: "node",
    testTimeout: 15000,
    include: ["src/**/*.{test,spec}.ts"],
    exclude: [
      ...configDefaults.exclude,
      "**/.agents/**",
      "**/.claude/**",
      "**/VRP/**",
      "**/crawler/**",
      "**/graphify-out/**",
    ],
  },
});
