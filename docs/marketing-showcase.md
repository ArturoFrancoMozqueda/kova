# Marketing showcase — real product screenshots

The cinematic product showcase (laptop mockup on the landing `/` and the export
route `/kova-showcase-video`) displays **real screenshots of Kova**, captured
from a populated tenant. This doc explains how to regenerate them.

- Component: `frontend/src/landing/showcase/KovaShowcase.tsx`
- Images: `frontend/public/showcase/{pos,inventory,caja,panel}.png` (1440×900 @2x)
- Capture script: `frontend/scripts/capture-showcase.mjs` (`npm run capture:showcase`)
- Demo seed: `backend/scripts/seed_demo.py` (catalog) + `backend/scripts/seed_demo_sales.py` (sales/shifts/inventory)

The screenshots are **static assets** — regenerate them whenever the product UI
changes or you want fresher demo data.

## Recommended: capture from a seeded demo tenant (local)

This keeps real business data out of the public landing while making every
screen look full. Everything runs locally and is torn down afterwards.

> Windows note: the native Postgres on port 5432 conflicts with Docker, so we
> run the demo DB on **5433**. The backend uses the Windows venv (`.venv-win`),
> so pass `--active` to `uv`.

```bash
# 1. Throwaway Postgres on 5433 (avoids the 5432 conflict)
docker run -d --name kova-pg -e POSTGRES_USER=pos -e POSTGRES_PASSWORD=pos \
  -e POSTGRES_DB=pos -p 5433:5432 postgres:16

# 2. Migrate + seed (from backend/, PowerShell)
$env:DATABASE_URL="postgresql+psycopg://pos:pos@localhost:5433/pos"
$env:VIRTUAL_ENV="<repo>\backend\.venv-win"
uv run --active alembic upgrade head
uv run --active python scripts/seed_demo.py        # catalog (idempotent)
uv run --active python scripts/seed_demo_sales.py  # sales/shifts/inventory (idempotent)

# 3. Run the stack (two shells)
#    backend/ :
uv run --active uvicorn app.main:app --host 127.0.0.1 --port 8000
#    frontend/ :
$env:VITE_API_BASE_URL="http://localhost:8000"; npm run dev

# 4. Capture (from frontend/)
$env:KOVA_BASE_URL="http://localhost:5173"
$env:KOVA_EMAIL="demo@kovademo.com"; $env:KOVA_PASSWORD="demo1234"
npm run capture:showcase

# 5. Tear down
docker rm -f kova-pg
```

Demo login: **demo@kovademo.com / demo1234** (owner). The seed also adds a
cashier and a business profile + receipt so the dashboard onboarding checklist
is complete and the Panel leads with KPIs.

## Alternative: capture from a real tenant

Point the capture at any running instance with your own credentials. Real
business numbers will then appear on the public landing.

```bash
KOVA_BASE_URL=https://kovasuite.com KOVA_EMAIL=you@negocio.mx KOVA_PASSWORD=•••• npm run capture:showcase
```

Credentials are read from the environment only — **never commit them**. Use an
owner/manager account (a cashier can't open Panel or Inventario).

## Notes

- The capture grabs the full app (AppShell sidebar + content), fills the POS
  cart, hides first-use tours + the onboarding celebration, and scrolls the
  Panel to the KPI/health section.
- If a PNG is missing, the showcase shows a branded "Captura de Kova"
  placeholder instead of a broken image.
- Story order (captions reuse `copy.landing.story.steps`):
  POS → Inventario → Caja → Panel (climax) → CTA.
