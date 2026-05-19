CLAUDE.md
Purpose
This file defines the brand identity and UI/UX rules for the Kova rebrand of the existing POS MVP.
Claude Code must read this file before making any change to frontend, design, copy, or branded assets.
This is a brand refresh, not a rebuild. The existing MVP (FastAPI backend, Vite/React frontend, Supabase, Stripe, Dexie offline sync, etc.) stays exactly as it is. We are only updating the visual layer to match the new Kova identity.
The product is being rebranded from "Sweet Home POS" to Kova — a customizable multi-tenant POS for small and medium businesses in Mexico.

What This Rebrand Touches
✅ YES — change these:

Logo (everywhere it appears)
Brand name in all UI ("Sweet Home" → "kova")
Color palette / design tokens
Typography (move to DM Sans)
Border radius, spacing, button styles
Microcopy tone and voice
Marketing/landing pages
Auth screens visual layer
Dashboard visual layer
App icon, favicon, splash screen
Email templates (visual only)
Loading/empty/error states styling
Animations (add intro animation, real-time pulses)

❌ NO — do not touch these:

Backend logic (FastAPI routes, services, models)
Database schema or migrations
Business logic in the frontend (sales flow, offline sync, cart, payments)
Component file structure (only update what's inside)
Routing structure
API contracts
Stripe integration
Permission/auth logic
i18n keys (only their text values where appropriate)
Sprint 15 (modifiers) or any in-flight feature work — let those merge first

If unclear whether something is "branding" or "logic," ASK before changing.

Brand Identity
Name and voice

Product name: kova (always lowercase in wordmark, including in UI strings)
Tagline: "Tu negocio, en flujo constante."
Tone: cercano, premium, cálido, profesional pero accesible
Audience: dueños de PyMEs en México
Inspiration: Stripe, Linear, Notion, Supabase — adapted for the Mexican market

Brand symbol
The logo is a closed circuit of 3 outer nodes (negocio, cliente, dinero) connected by 3 arcs, with a central blue core (Kova orchestrating the flow).
Implement as a single component (use existing component conventions in the repo) with two variants:

isotipo → only the symbol
horizontal → symbol + wordmark

The symbol must never be rotated, distorted, recolored outside the brand palette, or have its node proportions changed.

Design Tokens
All colors and spacing must come from CSS variables. Find and replace hardcoded values with these tokens. Never hardcode hex values going forward.
Colors
TokenHexUse--kova-blue#4F7EF7Primary action, links, focus, CTA accent--kova-blue-light#7BA7FFHover states, secondary accents--kova-ink#0F1117Primary text, logos, primary CTA bg--kova-mist#F5F6FAPage backgrounds, surfaces--kova-growth#1EBF8APositive metrics ONLY (sales up, goal hit)--kova-muted#6B7A99Secondary text--kova-tertiary#8892A4Tertiary text, captions--kova-border#E2E6EFDefault borders (always 0.5px)
Green (--kova-growth) is reserved exclusively for positive movement. Do not use it for buttons, links, or decoration.
Typography

Family: DM Sans (Google Fonts), weights 400 / 500 / 600 / 700 only
Hero: 48px / 600 / letter-spacing -1.5px
H2: 36px / 600 / letter-spacing -0.8px
H3: 18-20px / 600 / letter-spacing -0.3px
Body: 14-16px / 400 / line-height 1.5-1.6
Label: 11-12px / 500 / uppercase / letter-spacing 0.14em
Numbers (money, counts): font-variant-numeric: tabular-nums

Spacing
Use multiples of 8: 8, 16, 24, 32, 48, 64, 80. Migrate existing arbitrary spacing toward these values when touching a file, but don't refactor for refactor's sake.
Border radius

--radius-sm: 6px (chips, small tags)
--radius-md: 8px (buttons, inputs)
--radius-lg: 10px (cards, KPIs)
--radius-xl: 14px (sections, modals)

Borders and shadows

Default borders: 0.5px solid var(--kova-border)
Shadows: minimal. Single exception: hero/preview cards 0 24px 60px -20px rgba(15,17,23,0.25)


UI / UX Principles
Microcopy

Headings: sentence case, never Title Case
Buttons: imperative verb + noun ("Crear venta", "Guardar producto")
Errors: cause + recovery action
Empty states: explain + primary action
All text through i18n keys (default es-MX)

Icon system

Use whatever icon library the repo already uses — do not introduce a new one
Consistent stroke width and size across the app
Color inherits from text color, never hardcoded

Money formatting

Use the existing money formatter in the repo. Do not change its location or signature.
If it doesn't exist as a central utility, add one and migrate gradually as you touch files.


Animation Standards
Animations should communicate state changes and reinforce the "en flujo constante" tagline. Never block interaction.
Timing

Micro-interactions: 120-180ms
State transitions (modals, drawers): 220-280ms
Page transitions: 280-360ms
Intro animations: max 4s, skippable after 1s

Easing

Entrances: cubic-bezier(0.16, 1, 0.3, 1)
Exits: cubic-bezier(0.4, 0, 1, 1)
Spring pop: cubic-bezier(0.34, 1.56, 0.64, 1)

Intro animation (splash / landing hero)
A new component (e.g. IntroAnimation) following this sequence:

0–1.3s — Three outer nodes pop in sequentially with spring easing. Subtle labels appear.
1.3–2.6s — Three arcs draw clockwise, 700ms each, staggered 300ms.
2.6–3.2s — Central blue core scales in with ring + dot.
3.2–4.0s — Labels fade, wordmark "kova." and tagline fade in.
4s+ — Blue particles flow along arcs in continuous loop. Core pulses every 2.2s.

Must respect prefers-reduced-motion. When set, render final state instantly.
Real-time UI
Reinforce "en flujo constante" on dashboard:

Sales counter: count-up on update (600ms ease-out)
Live badge dot: pulse every 1.5s
New sale row: slide in from top (240ms), then highlight bg fade (800ms)
KPI delta arrows: rotate 180° if trend flips
Chart lines: smooth transition to new values, no full redraw


Migration Strategy
This is incremental, not a rewrite. Status as of 2026-05-17 reflected per phase.

Phase 1 — Foundation — DONE
- Tokens in frontend/src/styles.css
- DM Sans loaded (tailwind.config.js, index.html)
- Logo component at frontend/src/components/brand/Logo.tsx (isotipo + horizontal)
- formatMoney centralized in frontend/src/orders/format

Phase 2 — Component primitives — DONE for shared primitives (Button, Card, BillingBanner, Badge). Remaining legacy `hsl(var(--primary))` is intentional during gradual transition; replace only when touching the file for another reason.

Phase 3 — Brand swap — DONE
- Logo used in AuthView, VerifyEmailView, AppShell sidebar
- No "Sweet Home" strings remain in src/
- Favicon + PWA icons updated (frontend/public/)
- PWA manifest (vite.config.ts) has Kova name/description and lang es-MX
- Email templates updated to Spanish + Kova brand (backend/app/email/service.py)
- Page title set to "kova · POS para tu negocio"

Phase 4 — Landing and auth polish — IN PROGRESS
- Landing copy refreshed in i18n
- Auth subtitles + placeholders added (commit 351a544)
- IntroAnimation component exists; ensure it's wired into landing hero
- Pending: full es-MX localization of messages.ts (currently mostly English)

Phase 5 — Dashboard polish — IN PROGRESS
- Sidebar Kova logo: DONE (AppShell renders LogoMark)
- Real-time animations: count-up KPIs and live pulse badge — NEW work, gated behind incremental commits
- KPI cards using tokens, charts color audit pending

Phase 6 — Long tail
- Audit remaining hardcoded colors in `routes/` (Home.tsx contains scoped CSS variables for its own landing dark theme — those are not violations)
- Final visual QA pass per screen

Stripe live keys / live Checkout — LAST step before GA. Do not switch until everything else above is approved. Until then, Stripe stays in test mode in production. This is a hard rule per product owner.

Do not start a new phase until the previous one is reviewed and approved.

What to Preserve

All existing routes, paths, URLs
All API contracts
All database schema
All business logic (sales, payments, offline sync, refunds, shifts)
All test coverage that exists
Sprint 15 (modifiers) and any in-flight feature work — let those merge first


Working Mode for Claude Code
When making any change:

Read CLAUDE.md.
Read docs/current-sprint.md to confirm no conflict with in-flight work.
Identify which Phase (1-6) this change belongs to.
If the change touches business logic or backend, STOP and ask — this CLAUDE.md is for visual layer only.
Make the smallest possible change that achieves the brand goal.
Verify the affected screens still function (not just look).
Report files touched and which screens need manual verification.

Planning Docs Convention (Non-Negotiable)

`docs/current-sprint.md` is the single source of truth for what is in flight and what is next.
Supporting docs and their roles:

- `docs/current-sprint.md` — active backlog, critical / high / medium items, carry-overs, pre-beta ops checklist. Always update this file when work changes status.
- `docs/sprint-planning.md` — historical roadmap and completed sprints only. Do not add new in-flight tasks here.
- `docs/ux-review-2026-05-19.md` (and any future dated review) — detailed UX/product review notes referenced from `current-sprint.md`. Do not duplicate items between this file and `current-sprint.md`; keep the detail here and a one-line pointer there.
- `docs/deferred-scope.md` — explicit out-of-scope list. A deferred feature moves into scope only via the rule at the bottom of that file.
- `docs/risk-register.md` — risks and release gates.

Hard rules:

1. Do not create new top-level planning docs (e.g. `nuevo-backlog.md`, `sprint-X-plan.md`, `tasks.md`). If the user asks for one, push back and update `current-sprint.md` instead.
2. Before starting a session of work, read `current-sprint.md` and cross-check at least one item against the actual code. If you find `[ ]` items already implemented or `[x]` items not backed by code, surface the discrepancy before making changes.
3. When you finish a task, update `current-sprint.md` in the same change set (mark `[x]` or delete the line if it no longer adds context). Do not let the doc drift behind the code.
4. If a planning doc starts to conflict with another (e.g. a status table disagrees with a section body), stop and reconcile before adding new work. Do not stack new tasks on top of an inconsistent doc.
5. Archived/deleted planning docs do not come back. If the user references an old doc that no longer exists, point them to the equivalent section in `current-sprint.md`.

When in doubt, ask
If something looks like it might be branding but might be logic (e.g., a string that drives a feature toggle, a color that's status-dependent, a spacing that affects responsive breakpoints), ASK before changing.

Non-Negotiable Rules

Do not refactor for refactor's sake. Touch only what serves the rebrand.
Do not introduce new dependencies without explicit approval.
Do not change component APIs. Update internals, keep signatures.
Do not break existing tests. If a test fails due to brand changes (e.g., asserting "Sweet Home"), update the test minimally.
Do not change routing, paths, or URLs.
Do not touch the backend.
Do not deploy. Just commit and wait for review.


Final Reminder
This is a brand refresh. The goal is to make the existing product look and feel like Kova without breaking anything that works.
The MVP is in production with real customers. Treat it with care. Every change should be small, reversible, and verifiable.
Move fast on visuals. Move slow on anything else.