/// <reference types="vitest/config" />
import path from "path";
import fs from "fs";
import crypto from "crypto";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig, type Plugin } from "vite";

// Build hash used by the runtime version-check in main.tsx to detect stale
// bundles. Prefers the CI-provided commit SHA so all assets of a given deploy
// share the same hash; falls back to a random value for local builds.
const BUILD_HASH =
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.GITHUB_SHA?.slice(0, 12) ||
  process.env.COMMIT_SHA?.slice(0, 12) ||
  crypto.randomBytes(6).toString("hex");

// Writes dist/version.json after the bundle finishes, so the running client
// can fetch it (cache: no-store) and compare to its embedded __BUILD_HASH__.
function versionFilePlugin(): Plugin {
  return {
    name: "kova-version-file",
    apply: "build",
    closeBundle() {
      const outDir = path.resolve(__dirname, "dist");
      if (!fs.existsSync(outDir)) return;
      fs.writeFileSync(
        path.join(outDir, "version.json"),
        JSON.stringify({ hash: BUILD_HASH }) + "\n",
      );
    },
  };
}

export default defineConfig({
  define: {
    __BUILD_HASH__: JSON.stringify(BUILD_HASH),
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    react(),
    versionFilePlugin(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: false },
      manifest: {
        name: "Kova",
        short_name: "Kova",
        description: "POS multi-tenant offline-first para PyMEs en México",
        lang: "es-MX",
        theme_color: "#0F1117",
        background_color: "#F5F6FA",
        display: "standalone",
        start_url: "/register",
        icons: [
          { src: "/icons/pwa-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icons/pwa-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // App shell (HTML + hashed assets) is precached so authenticated POS
        // routes work offline-first. Marketing/auth routes are excluded from the
        // navigation fallback below — they always hit the network, so pricing
        // and landing copy can never be served stale.
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Kova's audience is es-MX: the latin(-ext) subsets cover all real
        // usage (unicode-range still lets a browser fetch the rest over the
        // network in the rare case it needs them). OG images only matter to
        // social crawlers, never to the app. Keeping these out of the precache
        // saves ~360 KB per install.
        globIgnores: [
          "**/*cyrillic*.woff2",
          "**/*greek*.woff2",
          "**/*vietnamese*.woff2",
          "**/og-image*.png",
        ],
        // The SPA navigation fallback is the EMPTY app-shell, not the
        // prerendered index.html (which is now the landing). app-shell.html is
        // written by scripts/prerender.mjs after this build, so add it to the
        // precache manifest explicitly (globPatterns ran before it existed).
        navigateFallback: "app-shell.html",
        additionalManifestEntries: [{ url: "app-shell.html", revision: BUILD_HASH }],
        navigateFallbackDenylist: [
          /^\/$/,
          /^\/login/,
          /^\/signup/,
          /^\/verify-email/,
          /^\/accept-invite/,
          /^\/forgot-password/,
          /^\/reset-password/,
          /^\/billing/,
          /^\/seguridad/,
          /^\/privacy/,
          /^\/terms/,
          /^\/cookies/,
          /^\/api\//,
        ],
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: "NetworkOnly",
          },
          {
            // Version probe must always hit the network so we can detect stale
            // bundles after a deploy.
            urlPattern: /\/version\.json$/,
            handler: "NetworkOnly",
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        // Defaults to localhost for native `npm run dev`; docker-compose.yml
        // overrides this to the "backend" service name for container-to-
        // container networking (localhost inside the frontend container is
        // the container itself, not the backend service).
        target: process.env.VITE_API_BASE_URL || "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    // Emit dist/.vite/manifest.json so scripts/prerender.mjs can resolve each
    // prerendered route's hashed chunks and inject modulepreload links.
    manifest: true,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Recharts and its transitive deps (react-redux, react-is, d3-*, ...) must be
          // matched before the generic "react" rule below, otherwise the substring match
          // pulls them into the eager vendor-react chunk and they load on every route.
          // This chunk is only imported by the lazy /reports route, so it loads on demand.
          if (
            /recharts|victory-vendor|d3-|react-smooth|react-redux|@reduxjs|reselect|immer|use-sync-external-store|es-toolkit|decimal\.js-light|eventemitter3|react-is/.test(
              id,
            )
          ) {
            return "vendor-charts";
          }
          // Sentry is only reached via dynamic import (observability/
          // errorReporting.ts + idle init in main.tsx). Must be matched before
          // the generic "react" rule below: "@sentry/react" contains "react",
          // and landing in the eager vendor-react chunk would drag the whole
          // Sentry graph back into every first load.
          if (id.includes("@sentry")) return "vendor-observability";
          if (id.includes("react") || id.includes("react-router-dom")) return "vendor-react";
          if (id.includes("dexie")) return "vendor-offline";
          if (id.includes("lucide-react")) return "vendor-icons";
          if (
            id.includes("class-variance-authority") ||
            id.includes("clsx") ||
            id.includes("tailwind-merge")
          ) {
            return "vendor-ui";
          }
          return "vendor";
        },
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    fileParallelism: false,
    exclude: ["node_modules", "dist", "e2e"],
  },
});
