# Showcase screenshots

These PNGs are the **real product screenshots** shown inside the laptop mockup in
the marketing showcase (`src/landing/showcase/KovaShowcase.tsx`) — on the landing
page `/` and the export route `/kova-showcase-video`.

Expected files (1440×900, captured @2x):

| File            | Screen                  | Route        |
| --------------- | ----------------------- | ------------ |
| `pos.png`       | POS / cobro             | `/register`  |
| `inventory.png` | Inventario              | `/inventory` |
| `caja.png`      | Caja / turno            | `/shifts`    |
| `panel.png`     | Panel (clímax)          | `/dashboard` |

## Regenerate them

From `frontend/`, with a running Kova instance and your own credentials
(credentials are read from the environment and never committed):

```bash
# bash
KOVA_BASE_URL=https://kovasuite.com KOVA_EMAIL=you@negocio.mx KOVA_PASSWORD=•••• npm run capture:showcase
```

```powershell
# PowerShell
$env:KOVA_BASE_URL="https://kovasuite.com"; $env:KOVA_EMAIL="you@negocio.mx"; $env:KOVA_PASSWORD="••••"; npm run capture:showcase
```

The script logs in, visits each screen, and overwrites the PNGs here. Commit the
updated images. If a screen hasn't been captured yet, the showcase shows a clean
branded "Captura de Kova" placeholder instead of a broken image.

See `frontend/scripts/capture-showcase.mjs` for details.
