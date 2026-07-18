# Performance pass — baseline y resultados (2026-07-18)

Medición antes/después de la pasada de rendimiento (gzip backend, N+1 restock,
`_net_item_rows` compartido, waterfall de Reportes, memoización, adapters de
Panel, register cache-first, headers de caché en Vercel).

Condiciones: local (docker compose, tenant demo `demo-bakery` con 24 órdenes /
10 productos), Lighthouse headless contra `vite preview` (solo landing —
`vite preview` no aplica los rewrites de vercel.json, así que las rutas de app
no son medibles localmente).

## Baseline (antes)

### Bundle (npm run build — chunks JS principales, gzip)

| Chunk | Raw | Gzip |
|---|---|---|
| vendor-charts (lazy, /reports + /dashboard) | 340.12 kB | 100.10 kB |
| vendor-react (eager) | 193.32 kB | 57.64 kB |
| index (entry) | 115.21 kB | 39.09 kB |
| vendor-offline (dexie) | 96.37 kB | 32.45 kB |
| KovaShowcase (landing) | 77.86 kB | 17.79 kB |
| vendor-observability (Sentry, idle) | 72.64 kB | 25.08 kB |
| ReportsView | 70.96 kB | 18.03 kB |
| vendor | 59.55 kB | 19.99 kB |
| CatalogView | 50.06 kB | 12.44 kB |
| RegisterView | 36.70 kB | 10.36 kB |
| Home (landing) | 33.65 kB | 7.65 kB |
| DashboardView | 32.99 kB | 8.73 kB |

### Lighthouse — landing `/` (vite preview, headless, mobile throttling)

| Métrica | Valor |
|---|---|
| Performance score | 89 |
| FCP | 2.3 s |
| LCP | 3.0 s |
| TBT | 160 ms |
| CLS | 0 |
| Speed Index | 2.3 s |

### business-story (GET /api/v1/reports/business-story, rango 7 días, demo local)

- Tamaño de respuesta con `Accept-Encoding: gzip`: **10,391 bytes (sin comprimir — el backend no negocia gzip)**
- `time_total` (runs 2-5, tras warm-up): **~35–38 ms** con datos demo (24 órdenes). El costo del N+1 y la re-agregación crece con el volumen real; localmente solo se verifica la dirección, no la magnitud.

### Conteo de requests (por código)

- Panel (Dashboard): 1 (profile) + 13 en paralelo = **14 requests**
- Reportes: **2 olas secuenciales** (2 requests, luego 4)

## Resultados (después)

### business-story

- Respuesta con `Accept-Encoding: gzip`: **2,361 bytes** (antes 10,391 sin comprimir → **−77%**). `content-encoding: gzip` verificado.
- Paridad de datos: el JSON identity-encoded después del refactor (B2 batch de stock + B3 `_net_item_rows` compartido) es **byte a byte idéntico** al baseline (`cmp` sobre el mismo rango/tenant).
- `time_total` local: ~31–54 ms (igual que baseline; con 24 órdenes demo el ahorro de queries no es visible en latencia — la magnitud real solo se verá en producción. Queries evitadas por request: 2 pasadas extra de order-items/refund-items, 1 query duplicada de órdenes, y N queries de stock → 1 agrupada).

### Requests

- Panel: **14 → 11** (se eliminaron `sales-summary` actual, `payment-breakdown`, `top-products`; adapters puros sobre `business-story` con paridad de forma y orden verificada por tests).
- Reportes: **2 olas → 1 ola** de 6 fetches paralelos.
- Register: apertura en frío pinta desde el caché Dexie del tenant y revalida en paralelo (antes bloqueaba en red).

### Bundle / Lighthouse

- Chunks sin cambios relevantes (DashboardView +0.2 kB por los adapters). Esta pasada es de red/CPU, no de bundle.
- Lighthouse landing (después, máquina en reposo): **score 87, FCP 2.4 s, LCP 3.2 s, TBT 200 ms, CLS 0** vs baseline 89/2.3/3.0/160/0. La landing no se tocó en esta pasada y el bundle es equivalente — la diferencia está dentro del ruido entre corridas de Lighthouse local headless; sirve como guard de no-regresión, no como medición de mejora.

### Suites (2026-07-18)

- Backend: `docker compose exec backend uv run pytest` — exit 0, suite completa verde (incluye los tests de valores exactos de reportes sin cambios y los 3 tests nuevos de compresión).
- Frontend: `npm test` — 252/252; typecheck limpio (via build).
- E2E (chromium): `register-sale`, `reports`, `offline-sync`, `app-shell` — 23/23.

### Pendiente de verificar en producción

- Headers de Vercel (`/assets/*` immutable, `version.json` no-store, `sw.js` no-cache): `curl -I` post-deploy.
- Latencia p95 de business-story con datos reales (B2/B3).
