import { defineConfig } from "vitest/config";

// Standalone from vite.config.ts (which is tailored for the Tauri dev server).
// The units under test are pure TS, so the default `node` environment suffices.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
  },
});
