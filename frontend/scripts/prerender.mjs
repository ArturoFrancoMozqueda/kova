// Postbuild prerender: inject server-rendered HTML for the public marketing
// and legal routes into the built client output, and split off an empty
// app-shell for the SPA catch-all / service-worker navigation fallback.
//
// Runs AFTER `vite build` (client) and the SSR build, so the existing build
// pipeline (PWA, version.json) is untouched. No inline <script> is added, so
// the CSP stays intact. Fails the build loudly if anything is off, so a broken
// prerender can never ship silently.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const dist = resolve(__dirname, "..", "dist");
const ROOT_MARKER = '<div id="root"></div>';
const CANONICAL_ORIGIN = "https://kovasuite.com";

const DEFAULT_TITLE = "kova · lleva tu emprendimiento con orden";
const DEFAULT_DESCRIPTION =
  "Kova es la app que usas en la caja para cobrar ventas, controlar tu inventario, organizar a tu equipo y ver qué se vende — todo desde una sola pantalla. Funciona aunque se vaya el internet.";

// Each content-bearing route. `assert` is a substring that MUST appear in the
// rendered HTML — our guarantee that the route actually rendered its content
// rather than an empty fallback.
const ROUTES = [
  { path: "/", out: "index.html", assert: "Deja de adivinar" },
  {
    path: "/privacy",
    out: "privacy/index.html",
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
  },
  {
    path: "/seguridad",
    out: "seguridad/index.html",
    title: "Seguridad · kova",
    description: "Cómo Kova protege tus datos y los de tu negocio.",
    assert: "Cómo protegemos tu negocio",
  },
  {
    path: "/cookies",
    out: "cookies/index.html",
    title: "Política de cookies · kova",
    description: "Política de cookies de Kova: qué cookies usamos y cómo gestionarlas.",
    assert: "cookies",
  },
];

function escapeAttr(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

function injectHead(html, { path, title, description }) {
  let out = html;
  const canonical = `${CANONICAL_ORIGIN}${path}`;
  // Inject canonical just before </head> (none exists in the source shell).
  out = out.replace(
    "</head>",
    `    <link rel="canonical" href="${escapeAttr(canonical)}" />\n  </head>`,
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
  const shell = readFileSync(shellPath, "utf8");

  if (!shell.includes(ROOT_MARKER)) {
    throw new Error(
      `prerender: could not find ${ROOT_MARKER} in dist/index.html — build output changed?`,
    );
  }

  // 1) Write the app-shell FIRST (a byte copy of the empty shell) — this is the
  //    SPA catch-all target and the SW navigation fallback. It must stay empty.
  writeFileSync(resolve(dist, "app-shell.html"), shell, "utf8");

  // 2) Import the SSR bundle and prerender each route.
  // pathToFileURL: on Windows a bare absolute path ("c:\\...") is rejected by
  // the ESM loader; it must be a file:// URL.
  const entryUrl = pathToFileURL(
    resolve(__dirname, "..", "dist-server", "entry-prerender.js"),
  ).href;
  const { render } = await import(entryUrl);

  for (const route of ROUTES) {
    const appHtml = render(route.path);
    if (!appHtml.includes(route.assert)) {
      throw new Error(
        `prerender: rendered ${route.path} is missing expected content "${route.assert}" — SSR likely emitted a fallback.`,
      );
    }
    let html = injectHead(shell, route);
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
