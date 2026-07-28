# Kova motion system

How movement works in the app shell. The landing has its own vocabulary and its
own brief (`docs/claude/landing-visual-brief.md`); this document owns everything
behind auth.

The short version lives in `.design-sync/conventions.md` under **Motion** — that
is the consumer-facing summary and should stay short. This file is the reasoning,
the hazards, and the exceptions.

## The one rule that outranks the others

**Kova is a point of sale.** A cashier is not admiring the interface; they are
trying to finish a transaction with a customer waiting. So motion is rationed by
how often a control is touched, not by how good the animation looks in isolation.

| Touches / day | Tier | Budget |
|---|---|---|
| 100+ (product tile, quantity steppers, payment method, cart sheet) | minimal | `duration-press` 80ms, or nothing |
| ~10–100 (remove a line, open a modal, nav) | standard | `duration-quick` … `duration-modal` |
| A few (sale completed, first-use tour, empty states) | delight | up to `duration-celebrate`, but the primary CTA is never blocked |
| Keyboard-triggered anything | none | power users have already decided; do not animate |

A corollary that has bitten this codebase: **high frequency is sometimes an
argument for better motion, not less.** The mobile cart sheet is opened ~200
times a day and its movement carries spatial meaning ("where did the cart go"),
so it keeps its animation — it just had to become interruptible and honest.

## Tokens

Defined in `frontend/src/styles.css`, reachable from Tailwind as
`duration-*` / `ease-*` (see `theme.extend.transitionDuration` and
`transitionTimingFunction`). `MOTION_MS` in `frontend/src/lib/motion.ts` mirrors
the durations for JS; `lib/motion.test.ts` parses the CSS and fails on drift.

| Token | ms | For |
|---|---|---|
| `--kova-dur-press` | 80 | `:active` on hot controls |
| `--kova-dur-quick` | 120 | chip/segment toggle, icon swap, tooltip |
| `--kova-dur-hover` | 180 | hover colour/border/shadow — the default |
| `--kova-dur-panel` | 240 | dropdown, popover, toast, inline reveal |
| `--kova-dur-modal` | 280 | dialog, sidebar, bottom sheet |
| `--kova-dur-celebrate` | 600 | completed sale, count-up |
| `--kova-dur-panel-exit` | 160 | ~0.65× panel |
| `--kova-dur-modal-exit` | 180 | ~0.65× modal |

**Why hover is 180 and not 150.** 150ms is Tailwind's default, so a 150ms token
would be an unverifiable no-op — you could never distinguish a tokenised site
from one that just forgot. 180ms is also what every landing hover already uses,
so the two halves of the product now agree.

| Easing | Curve | For |
|---|---|---|
| `--kova-ease-standard` | `cubic-bezier(0, 0, 0.2, 1)` | the default; byte-identical to Tailwind's `ease-out` |
| `--kova-ease-entrance` | `cubic-bezier(0.16, 1, 0.3, 1)` | entrances that travel a distance |
| `--kova-ease-exit` | `cubic-bezier(0.4, 0, 1, 1)` | accelerating exits — reads as "gone", not "leaving" |
| `--kova-ease-spring` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | overshoot, for confirmation only |

`ease-standard` is deliberately identical to `ease-out` so that adopting it
anywhere that already said `ease-out` is provably a zero-pixel change.
`ease-entrance` is an expo-out: it completes ~90% of the change in the first 30%
of the duration, which is right for something travelling and wrong for a 120ms
colour swap, where it reads as a jump with a lazy tail.

**Do not rename `entrance` / `exit` / `spring`.** They have ~55 references in
`src/landing/**` and `src/routes/Home.tsx`.

## Vocabulary

Enter: `animate-fade-in`, `animate-scale-in`, `animate-slide-up`,
`animate-slide-in-right`. Exit: `animate-fade-out`, `animate-scale-out`,
`animate-slide-down`. Loading: `animate-pulse-soft`.

Component-level keyframes that the utility vocabulary cannot express live in
`styles.css` under the `kv-*` namespace: `kv-count-pop`, `kv-row-collapse`,
`kv-cart-sheet`, `kv-success-badge`, `kv-success-headline`, `kv-tkt-print`.
Three namespaces coexist and never cross: `kv-*` (app), `lp-*` (landing),
`tkt-*` (ticket material).

Anything added to the vocabulary must also go in
`.design-sync/tailwind.dssync.config.js`'s safelist, or it will be missing from
`ds-bundle/_ds_bundle.css`.

## Exit animations

`if (!open) return null` gives you an entrance and no exit. Use
`usePresence(open, exitMs)` from `@/lib/usePresence`, which keeps the node
mounted for the exit and cancels if it reopens mid-flight. `usePresenceKeys` is
the list version, for rows leaving a collection; it remembers each row's position
so it collapses where it was.

Two contracts worth knowing:

- **Delays come from `MOTION_MS`, never from a literal.** The toast used to hold
  a bare `200` in JS against `0.2s` in CSS, which also disagreed under reduced
  motion. `exitDelayMs()` returns 0 when the user opted out.
- **Focus is not motion.** In `Dialog`, Escape/focus-restore stay tied to `open`
  while the scroll lock follows `mounted`. A keyboard user gets focus back
  immediately; the page does not reflow under a dialog still on screen.

A `transitionend`/`animationend` listener was considered and rejected: jsdom
never fires it (every Dialog test would hang on close), and it does not fire for
a `display:none` or interrupted animation — so you need a timeout fallback
anyway, and then two mechanisms must agree.

## Reduced motion

`styles.css` has a global block that neutralizes `animation-duration`,
`animation-delay`, `animation-iteration-count` and `transition-duration`. It
covers all CSS motion, so `motion-reduce:` variants are usually redundant.

It does **not** cover rAF loops, JS timers, or JS-interpolated SVG attributes.
Those must ask `usePrefersReducedMotion()` / `prefersReducedMotion()` from
`@/lib/usePrefersReducedMotion` — one reactive source, `matchMedia`-absence safe
(jsdom here has none) and prerender-safe.

`transition-delay` is deliberately **not** reset: its only consumers are the
landing reveals, whose own reduced-motion block already forces the end state.

Known follow-up: the global block is a blanket kill ("zero"), where the better
policy is "gentler, not zero" — keep opacity and colour, drop movement. That
needs per-pattern rules across app *and* landing and is the change most likely to
break the landing for a11y users unnoticed, so it was left out of the foundation
work. The precondition now exists: every transition names its properties.

## Hazards

### Print containing blocks

**A non-`none` `transform`, `filter` or `backdrop-filter` on an ancestor of
`.print-receipt-root` or `.print-corte-root` makes that ancestor their containing
block, and the absolutely positioned print root lands mid-page instead of at the
paper origin.**

This is why every keyframe in `tailwind.config.js` ends at `transform: none`
rather than `translateY(0)` or `scale(1)`: `ViewLayout` carries
`animate-fade-in` and is an ancestor of every print root. Before the fix it
survived only because `animation-fill-mode` defaults to `none`, so the computed
transform snapped back — meaning the first `forwards` anyone added would have
broken printing.

Ancestor chains, for reference:

| Print root | Chain |
|---|---|
| `RegisterView` success overlay | AppShell main column → `ViewLayout` → success overlay → `TicketPaper` |
| `ShiftView` corte | AppShell main column → `ViewLayout` → `.print-only` |
| `ReceiptDisplay` | AppShell main column → `ViewLayout` → `Card` → `CardContent` → `TicketPaper` |

Safe by construction: the register's cart sheet (a **sibling** of the success
overlay, verified) and the sale-success badge (a descendant sibling of the
receipt). Unsafe: the AppShell main content `div`, `ViewLayout`, and anything
wrapping `TicketPaper`.

When a screen-only decoration needs a transform or filter near a print surface,
add an explicit `@media print` neutralizer. `.tkt-paper { filter: none }` is the
original precedent; `.kv-cart-sheet` and `.kv-tkt-reveal [data-tkt-band]` follow
it.

### Layout-property animation

`max-height` in particular. Beyond the frame cost, the rendered height is
`min(content, max-height)`, so the visible motion finishes early and then stops —
which is why the old cart sheet appeared to snap open and ease shut. A
`transform` interpolates in real visual position, which also makes it
interruptible: a reversal resumes from where the element actually is.

## Documented exceptions

Each of these animates something the rules discourage, on purpose:

- **Desktop sidebar collapse animates `width`.** A transform would require moving
  the content column's left edge, and the only element that can do that is an
  ancestor of the print roots. Rare, deliberate, two elements reflow, no hot
  path. Fallback if it ever measures badly: `lg:transition-none`.
- **Dashboard and health-card progress bars animate `width`.** A `scaleX` rewrite
  needs a markup change and visibly distorts the `rounded-full` end caps. At most
  four per view, none on a hot path.
- **`index.html` duplicates `pulse-soft` as `kovaPulse`.** It paints before the
  CSS bundle arrives, so it cannot reference the tokens. Values are kept in sync
  by hand (1.5s, floor 0.6).
- **`IntroAnimation.module.css` has its own `intro-pulse-soft`.** It is a CSS
  Module, so Vite hashes the keyframe name — it cannot collide, and it is not a
  real duplicate. Its opacity floor is deeper on purpose (it plays against near
  black).
- **`/kova-showcase-video` overrides the reduced-motion reset with
  `!important`.** It is a capture route driven by
  `scripts/capture-showcase.mjs`, not a surface anyone browses. Do not "clean up"
  those declarations.

## What is deliberately not animated

- **Recharts entrance** (`isAnimationActive={false}` in all three chart
  primitives). It interpolates SVG attributes in JS, which the CSS reduced-motion
  reset cannot reach, so enabling it would animate for users who asked not to.
  It also desynchronizes the `role="status"` detail card from the rendered
  geometry: hovering a bar that is still growing announces the final value
  against a mark that visually says something else. If it is ever revisited, the
  only defensible form is `isAnimationActive={!prefersReducedMotion}` with
  `animationDuration={280}`, on the trend `<Line>` only.
- **Route transitions.** Every route is `React.lazy`, so the Suspense fallback
  mounts, unmounts, then the view mounts — a route-level entrance would fire
  twice per navigation with network-dependent spacing. Each view already stamps
  its own `animate-fade-in`.
- **Per-tile entrance stagger in the register product grid.** `listProducts()`
  has no limit, nothing is virtualized, every tile holds an `<img srcSet>`, and
  the grid re-renders on every cart mutation.
- **Count-up on the cart total or the sale-success amount.** That number is read
  aloud to the customer. Tweening it puts a number on screen that is not the
  total.
- **Motion on chart live regions** (`ChartDetailPanel`, the inline block in
  `SalesTrendChart`). Fading in a number the user is reading, while a screen
  reader announces it, helps nobody.
- **Anything on "Cobrar" beyond its spinner**, and anything on keyboard submit.

## Not done yet

Specified but not built, in rough priority order: sidebar label crossfade on
collapse (with `aria-hidden`, since the collapsed item already has a `title`); an
animated active-nav indicator as a pseudo-element that grows in height (no JS, no
`ResizeObserver`); a ~140ms delay on the route fallbacks so a fast chunk never
flashes a spinner; a shared animated `Disclosure` primitive for three of the five
unanimated reports disclosures (`ProductCostEditor` and the `<details>` in
`BusinessHealthCard` should stay as they are); a CSS-only mount stagger for the
Reports bento, keyed on the applied date range so it replays on change; and
entrances for `PWAUpdatePrompt`, `BillingBanner` and `view-states`.

## Verifying motion changes

- `/dev/components-preview` (dev only) renders every primitive on white and on
  ink, and has a **Motion** section with one swatch per duration and easing
  token. Use it to settle timing arguments empirically.
- Open **and close** a dialog at desktop and at ≤640px, then open/close/open
  rapidly: no ghost node, no double overlay, focus on the trigger both times.
- **Print regression** after anything touching the register, shifts or orders:
  `/orders/:id`, a completed sale (with the cart sheet expanded *and* collapsed),
  and a shift corte — each at 80mm. Anything starting mid-page means a containing
  block leaked in.
- **Reduced motion**: DevTools → Rendering → Emulate `prefers-reduced-motion`.
  Dialogs leave no residual node, toasts do not hold, the receipt is never blank,
  `/kova-showcase-video` still animates. Then toggle the emulation *with the page
  open* — the app must react without a reload.
