import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import jsxA11y from "eslint-plugin-jsx-a11y";

export default [
  {
    // Playwright owns and recreates these generated directories while suites
    // run. ESLint must not traverse an output tree that may disappear mid-scan.
    ignores: ["dist", "dist-server", "node_modules", "coverage", "test-results", "playwright-report"],
  },
  js.configs.recommended,
  // Node globals for config files (vite.config.ts, tailwind.config.js, postcss.config.js)
  // and build scripts (scripts/*.mjs, e.g. the prerender postbuild step).
  {
    files: ["*.config.{js,ts}", "*.config.*.{js,ts}", "scripts/**/*.{js,mjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        require: "readonly",
        module: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        process: "readonly",
        console: "readonly",
      },
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsparser,
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        window: "readonly",
        document: "readonly",
        console: "readonly",
        crypto: "readonly",
        fetch: "readonly",
        Intl: "readonly",
        process: "readonly",
        RequestInit: "readonly",
        Response: "readonly",
        URLSearchParams: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tseslint,
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
      "jsx-a11y": jsxA11y,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      ...jsxA11y.flatConfigs.recommended.rules,
      // TypeScript's own checker handles undefined-variable errors for TS/TSX;
      // no-undef produces false positives for DOM types and the react-jsx transform.
      "no-undef": "off",
      "no-console": ["error", { allow: ["warn", "error"] }],
    },
  },
];
