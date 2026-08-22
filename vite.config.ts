import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const host = process.env.TAURI_DEV_HOST;

// Absolute, so an entry does not depend on the cwd a caller happens to use —
// `tauri.conf.json`'s `beforeBuildCommand` is one such caller.
const entry = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  // Two entries, one build (`specs/web_demo_spec.md` §2.6): the landing page at
  // `/` and the editor at `/demo/`. `base` is deliberately NOT set here — it
  // stays `/`, which is what Tauri's `tauri://localhost` needs, and the Pages
  // deploy passes `--base=/zukai/` through `bun run build:web` instead. A
  // `mode`-conditional base was declined: it makes the desktop artifact depend
  // on an env var being right rather than on which command was typed.
  build: {
    rollupOptions: {
      input: {
        landing: entry("index.html"),
        demo: entry("demo/index.html"),
      },
    },
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));
