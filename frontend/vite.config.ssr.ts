import path from "path";
import crypto from "crypto";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Minimal config for the build-time SSR pass that prerenders the landing and
// legal pages (see scripts/prerender.mjs). It deliberately excludes the PWA
// plugin and the version-file plugin so this pass can never regenerate the
// service worker or touch dist/. __BUILD_HASH__ is defined because the landing
// import chain transitively reaches modules that reference it.
const BUILD_HASH =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.GITHUB_SHA?.slice(0, 12) ||
  process.env.COMMIT_SHA?.slice(0, 12) ||
  crypto.randomBytes(6).toString("hex");

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [react()],
});
