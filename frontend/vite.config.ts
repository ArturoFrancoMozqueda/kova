/// <reference types="vitest/config" />
import path from "path";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vite";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  plugins: [
    react(),
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
        navigateFallback: "index.html",
        navigateFallbackDenylist: [
          /^\/$/,
          /^\/login/,
          /^\/signup/,
          /^\/verify-email/,
          /^\/billing/,
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
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    exclude: ["node_modules", "dist", "e2e"],
  },
});
