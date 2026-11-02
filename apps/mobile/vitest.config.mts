/**
 * Vitest runs the pure TypeScript logic (transport, demo device, form model) in Node.
 * React Native screens are verified in the iOS Simulator instead.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30_000,
  },
});
