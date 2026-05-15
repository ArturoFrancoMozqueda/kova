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
      registerType: "prompt",
      devOptions: { enabled: false },
      manifest: {
        name: "POS — Point of Sale",
        short_name: "POS",
        description: "Offline-first point of sale for small businesses",
        theme_color: "#2d2418",
        background_color: "#faf7f2",
        display: "standalone",
        start_url: "/register",
        icons: [
          { src: "/icons/pwa-192.svg", sizes: "192x192", type: "image/svg+xml" },
          { src: "/icons/pwa-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" },
        ],
      },
      workbox: {
        // Cache the app shell (HTML, JS, CSS) and static assets
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        // Network-first for API calls — never serve stale API responses from cache
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
