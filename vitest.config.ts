import { defineConfig } from "vitest/config";

// Standalone from vite.config.ts (which is tailored for the Tauri dev server).
// The units under test are pure TS, so the default `node` environment suffices.
export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    // Vitest stubs CSS imports with an empty string by default. The exporter
    // embeds `styles/diagram.css` in the file it writes (`?raw`), so stubbing it
    // would leave every assertion about the exported stylesheet passing on "".
    css: true,
  },
});
