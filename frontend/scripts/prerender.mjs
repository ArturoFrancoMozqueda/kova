// Postbuild prerender: inject server-rendered HTML for the public marketing
// and legal routes into the built client output, and split off an empty
// app-shell for the SPA catch-all / service-worker navigation fallback.
//
// Runs AFTER `vite build` (client) and the SSR build, so the existing build
// pipeline (PWA, version.json) is untouched. No inline <script> is added, so
// the CSP stays intact. Fails the build loudly if anything is off, so a broken
// prerender can never ship silently.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, "..", "dist");
const ROOT_MARKER = '<div id="root"></div>';
const CANONICAL_ORIGIN = "https://kovasuite.com";

// These MUST match the <title> and <meta name="description"> in index.html —
// injectHead() string-replaces them to give each legal route its own head. If
// they drift from the shell, the replacement silently no-ops and legal pages
// inherit the landing's title/description.
const DEFAULT_TITLE = "Kova | Punto de venta e inventario para negocios en México";
const DEFAULT_DESCRIPTION =
  "Kova es el punto de venta para cafeterías, panaderías y negocios de mostrador. Cobra, controla inventario y cuadra caja desde una sola app.";

// JSON-LD structured data for the landing page. A <script type="application/
// ld+json"> is a passive data block, not executable JS. Price mirrors
// src/billing/standardPlan.ts ($299 MXN/month = 29900 minor units).
const LANDING_STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${CANONICAL_ORIGIN}/#organization`,
      name: "Kova",
      url: `${CANONICAL_ORIGIN}/`,
      logo: `${CANONICAL_ORIGIN}/icons/pwa-512.svg`,
      email: "posprojectsupport@gmail.com",
      areaServed: "MX",
    },
    {
      "@type": "SoftwareApplication",
      name: "Kova",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      url: `${CANONICAL_ORIGIN}/`,
      description: DEFAULT_DESCRIPTION,
      offers: {
        "@type": "Offer",
        price: "299",
        priceCurrency: "MXN",
      },
    },
  ],
};

// Each content-bearing route. `assert` is a substring that MUST appear in the
// rendered HTML — our guarantee that the route actually rendered its content
// rather than an empty fallback. `moduleKey` is the route component's key in
// dist/.vite/manifest.json, used to modulepreload the route's chunks so the
// hydrating client doesn't discover them one network hop at a time
// (index.js → Home.js → KovaShowcase.js).
const ROUTES = [
  {
    path: "/",
    out: "index.html",
    assert: "Cobra, controla tu inventario",
    structuredData: LANDING_STRUCTURED_DATA,
    moduleKey: "src/routes/Home.tsx",
  },
  {
    path: "/privacy",
    out: "privacy/index.html",
    moduleKey: "src/routes/LegalPage.tsx",
    title: "Aviso de privacidad · kova",
    description: "Aviso de privacidad de Kova: qué datos tratamos y cómo los protegemos.",
    assert: "Aviso de privacidad",
  },
  {
    path: "/terms",
    out: "terms/index.html",
    title: "Términos y condiciones · kova",
    description: "Términos y condiciones del servicio Kova.",
    assert: "Términos",
    moduleKey: "src/routes/LegalPage.tsx",
  },
  {
    path: "/seguridad",
    out: "seguridad/index.html",
    title: "Seguridad · kova",
    description: "Cómo Kova protege tus datos y los de tu negocio.",
    assert: "Cómo protegemos tu negocio",
    moduleKey: "src/routes/LegalPage.tsx",
  },
  {
    path: "/cookies",
    out: "cookies/index.html",
    title: "Política de cookies · kova",
    description: "Política de cookies de Kova: qué cookies usamos y cómo gestionarlas.",
    assert: "cookies",
    moduleKey: "src/routes/LegalPage.tsx",
  },
];

// The two font files that paint above-the-fold text: Bricolage latin (the
// hero <h1> display face) and Inter latin (body). Without a preload they are
// discovered only after the CSS parses, delaying the LCP swap. Latin subsets
// only — preloading more would compete with the LCP for bandwidth. Fails
// loudly if @fontsource-variable renames its files.
const CRITICAL_FONT_PATTERNS = [
  /^bricolage-grotesque-latin-wght-normal-.*\.woff2$/,
  /^inter-latin-wght-normal-.*\.woff2$/,
];

function fontPreloadLinks() {
  const assets = readdirSync(resolve(dist, "assets"));
  return CRITICAL_FONT_PATTERNS.map((pattern) => {
    const file = assets.find((name) => pattern.test(name));
    if (!file) {
      throw new Error(
        `prerender: no dist/assets file matches ${pattern} — fontsource file naming changed?`,
      );
    }
    return `    <link rel="preload" href="/assets/${file}" as="font" type="font/woff2" crossorigin>\n`;
  }).join("");
}

// Walk the Vite manifest from a route module and collect every hashed JS/CSS
// file it statically pulls in (Home → KovaShowcase → previews, ...).
function collectRouteAssets(manifest, moduleKey) {
  const js = [];
  const css = [];
  const seen = new Set();
  const walk = (key) => {
    if (seen.has(key)) return;
    seen.add(key);
    const item = manifest[key];
    if (!item) return;
    js.push(item.file);
    css.push(...(item.css ?? []));
    for (const imported of item.imports ?? []) walk(imported);
  };
  walk(moduleKey);
  return { js, css };
}

// Inject modulepreload/stylesheet links for the route's chunks, skipping any
// file the shell already references (the eager entry + vendors). Duplicate
// stylesheets are harmless — Vite's dynamic-import preload helper skips links
// that already exist — but there's no reason to emit them.
function injectRouteAssets(html, manifest, moduleKey) {
  const { js, css } = collectRouteAssets(manifest, moduleKey);
  const links = [
    ...js
      .filter((file) => !html.includes(file))
      .map((file) => `    <link rel="modulepreload" crossorigin href="/${file}">\n`),
    ...css
      .filter((file) => !html.includes(file))
      .map((file) => `    <link rel="stylesheet" crossorigin href="/${file}">\n`),
  ];
  if (links.length === 0) return html;
  return html.replace("</head>", `${links.join("")}  </head>`);
}

// Public prerendered pages already contain their useful content and working
// links. Keep CSS on the critical path, but defer downloading their React
// graph until after the first paint. The empty app-shell is untouched because
// authenticated/client-only routes still need JavaScript immediately.
function deferPrerenderHydration(html) {
  const entryPattern = /<script type="module" crossorigin src="([^"]+)"><\/script>/;
  const entry = html.match(entryPattern)?.[1];
  if (!entry) {
    throw new Error("prerender: could not find the Vite client entry script");
  }
  return html
    .replace(
      entryPattern,
      `<script defer src="/hydrate-prerender.js" data-entry="${escapeAttr(entry)}"></script>`,
    )
    .replace(/\s*<link rel="modulepreload"[^>]*>\n?/g, "")
    .replace(
      /(<link rel="preload"[^>]+as="font"[^>]+crossorigin)>/g,
      '$1 media="(min-width: 641px)">',
    );
}

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

// Serialize JSON-LD for safe embedding in an HTML <script>. Escaping "<" as
// < prevents a "</script>" inside any string value from closing the tag
// early; the sequence is still valid JSON and parses back to the same object.
function structuredDataScript(data) {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `    <script type="application/ld+json">${json}</script>\n`;
}

function injectHead(html, { path, title, description, structuredData }) {
  let out = html;
  const canonical = `${CANONICAL_ORIGIN}${path}`;
  const jsonLd = structuredData ? structuredDataScript(structuredData) : "";
  // Inject canonical (and any JSON-LD) just before </head> (none exists in the
  // source shell).
  out = out.replace(
    "</head>",
    `    <link rel="canonical" href="${escapeAttr(canonical)}" />\n${jsonLd}  </head>`,
  );
  if (title) {
    out = out.replace(
      `<title>${DEFAULT_TITLE}</title>`,
      `<title>${title}</title>`,
    );
  }
  if (description) {
    out = out.replace(
      `<meta name="description" content="${escapeAttr(DEFAULT_DESCRIPTION)}" />`,
      `<meta name="description" content="${escapeAttr(description)}" />`,
    );
  }
  return out;
}

async function main() {
  const shellPath = resolve(dist, "index.html");
  // Every written page (app-shell included) preloads the two critical fonts.
  const shell = readFileSync(shellPath, "utf8").replace(
    "</head>",
    `${fontPreloadLinks()}  </head>`,
  );

  if (!shell.includes(ROOT_MARKER)) {
    throw new Error(
      `prerender: could not find ${ROOT_MARKER} in dist/index.html — build output changed?`,
    );
  }

  const manifest = JSON.parse(
    readFileSync(resolve(dist, ".vite", "manifest.json"), "utf8"),
  );

  // 1) Write the app-shell FIRST — this is the SPA catch-all target and the SW
  //    navigation fallback. Its #root must stay empty. It's served for every
  //    client-only app route AND every unknown URL (Vercel's catch-all rewrite
  //    returns it with a 200), so without a robots directive each of those
  //    reads as an indexable soft-404. Mark it noindex; the prerendered public
  //    routes below are written from the untouched `shell`, so they don't
  //    inherit it. Auth pages (/login, /signup) fall back here too — correctly
  //    kept out of the index.
  const appShell = shell.replace(
    "</head>",
    '    <meta name="robots" content="noindex" />\n  </head>',
  );
  writeFileSync(resolve(dist, "app-shell.html"), appShell, "utf8");

  // 2) Import the SSR bundle and prerender each route.
  // pathToFileURL: on Windows a bare absolute path ("c:\\...") is rejected by
  // the ESM loader; it must be a file:// URL.
  const entryUrl = pathToFileURL(
    resolve(__dirname, "..", "dist-server", "entry-prerender.js"),
  ).href;
  const { render } = await import(entryUrl);

  for (const route of ROUTES) {
    const appHtml = await render(route.path);
    if (!appHtml.includes(route.assert)) {
      throw new Error(
        `prerender: rendered ${route.path} is missing expected content "${route.assert}" — SSR likely emitted a fallback.`,
      );
    }
    let html = injectHead(shell, route);
    html = injectRouteAssets(html, manifest, route.moduleKey);
    html = deferPrerenderHydration(html);
    html = html.replace(ROOT_MARKER, `<div id="root">${appHtml}</div>`);
    const outPath = resolve(dist, route.out);
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, html, "utf8");
    console.log(`prerender: wrote ${route.out} (${route.path})`);
  }

  // 3) Sanity: app-shell stays empty so app routes never flash landing markup.
  const writtenShell = readFileSync(resolve(dist, "app-shell.html"), "utf8");
  if (!writtenShell.includes(ROOT_MARKER)) {
    throw new Error("prerender: app-shell.html must keep an empty #root.");
  }

  console.log("prerender: done");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
