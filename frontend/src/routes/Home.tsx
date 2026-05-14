import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  ArrowRight,
  BarChart3,
  Check,
  CreditCard,
  LayoutDashboard,
  Package,
  Receipt,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  Users,
  WifiOff,
  type LucideIcon,
} from "lucide-react";

const included = [
  "Tenant signup and secure sessions",
  "Catalog, products, categories, and modifiers",
  "Cash, bank transfer, manual card, and split payment records",
  "Offline sales queue with retry and recovery",
  "Inventory tracking with low-stock visibility",
  "Shifts, receipts, refunds, voids, and sales reporting",
];

const faq = [
  {
    q: "Is this a marketplace or payment processor?",
    a: "No. It is POS software for running sales, catalog, inventory, shifts, and reports. Stripe is used only for the monthly SaaS subscription.",
  },
  {
    q: "Can I use it without internet?",
    a: "The register can queue sales locally and sync them when the connection returns, so short outages do not stop the counter.",
  },
  {
    q: "Is there more than one plan?",
    a: "No. The beta offer is one Standard Plan at $199 MXN/month with all currently available features included.",
  },
  {
    q: "Who is it best for right now?",
    a: "Bakery and small food retail teams that need a focused POS core before advanced restaurant or enterprise workflows.",
  },
];

const setupSteps: Array<{ icon: LucideIcon; title: string; text: string }> = [
  { icon: Sparkles, title: "Create your account", text: "Register the business, verify email, and keep access protected with server-managed sessions." },
  { icon: CreditCard, title: "Subscribe once", text: "Activate the Standard Plan through Stripe Checkout at $199 MXN/month." },
  { icon: Package, title: "Configure products", text: "Add the products, categories, modifiers, and inventory tracking your counter needs." },
  { icon: ShoppingCart, title: "Start selling", text: "Open the register, record payments, issue receipts, and review real sales data." },
];

const benefits: Array<[LucideIcon, string, string]> = [
  [Receipt, "Faster daily operations", "Sales, payments, receipts, refunds, voids, and shifts are designed around counter work."],
  [WifiOff, "Offline confidence", "Queued offline sales retry with recovery instead of silently losing transactions."],
  [Package, "Inventory visibility", "Tracked products and low-stock thresholds help owners know what needs attention."],
  [LayoutDashboard, "Clear performance", "Dashboard and reports answer what sold, how customers paid, and what changed."],
];

const analyticsPreview: Array<[LucideIcon, string, string]> = [
  [BarChart3, "Sales and ticket size", "Calculated from completed orders and totals."],
  [CreditCard, "Payment mix", "Cash, transfer, manual card, and split payments."],
  [Package, "Top products", "Calculated from order item quantities and gross sales."],
  [Users, "Team activity", "Deferred until employee management is exposed through the API."],
];

export default function Home() {
  const { state } = useAuth();
  const isAuthenticated = state.status === "authenticated";
  const primaryTarget = isAuthenticated ? "/dashboard" : "/signup";
  const secondaryTarget = isAuthenticated ? "/register" : "/login";

  return (
    <main className="min-h-screen overflow-hidden bg-background text-foreground">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-background/88 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6 lg:px-8">
          <Link to="/" className="flex items-center gap-3" aria-label="POS home">
            <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-sm font-black text-primary-foreground">
              POS
            </span>
            <span className="text-sm font-semibold tracking-tight">Reliable POS</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Landing navigation">
            <a href="#features" className="hover:text-foreground">Benefits</a>
            <a href="#analytics" className="hover:text-foreground">Analytics</a>
            <a href="#pricing" className="hover:text-foreground">Pricing</a>
            <a href="#faq" className="hover:text-foreground">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to={secondaryTarget} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {isAuthenticated ? "Open register" : "Log in"}
            </Link>
            <Link to={primaryTarget} className={buttonVariants({ size: "sm" })}>
              {isAuthenticated ? "Go to dashboard" : "Start setup"}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </header>

      <section className="relative border-b border-border/70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,hsl(var(--primary)/0.14),transparent_34%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.42))]" />
        <div className="relative mx-auto flex min-h-[calc(100vh-66px)] max-w-7xl flex-col justify-center px-4 py-16 sm:px-6 lg:px-8">
          <div className="max-w-3xl">
            <Badge variant="secondary" className="mb-5 gap-2 border border-border bg-background/80">
              <ShieldCheck className="h-3.5 w-3.5 text-primary" />
              Built for paid bakery and food retail beta tenants
            </Badge>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              A focused POS SaaS for businesses that need to sell without chaos.
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              Configure products, run the register, record payments, recover offline sales, track inventory, and review real performance from one clean operating workspace.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to={primaryTarget} className={buttonVariants({ size: "lg" })}>
                {isAuthenticated ? "Continue setup" : "Create account"}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
                See the $199 MXN plan
              </a>
            </div>
          </div>

          <div className="mt-12 rounded-lg border border-border/80 bg-card/95 p-3 shadow-2xl shadow-primary/10">
            <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-md border bg-background p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">Today</p>
                    <p className="text-lg font-semibold">Business performance</p>
                  </div>
                  <Badge variant="success">Real data only</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    ["Net sales", "Calculated after sales"],
                    ["Orders", "No completed orders yet"],
                    ["Avg ticket", "Shown when orders exist"],
                  ].map(([label, value]) => (
                    <div key={label} className="rounded-md border bg-card p-4">
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="mt-2 text-sm font-semibold leading-6">{value}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 rounded-md border bg-card p-4">
                  <div className="flex items-center gap-3">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    <div>
                      <p className="text-sm font-medium">Reports stay honest</p>
                      <p className="text-sm text-muted-foreground">If there are no sales in a period, the app shows an empty state instead of demo charts.</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {setupSteps.map(({ icon: Icon, title, text }) => (
                  <div key={title} className="rounded-md border bg-background p-4">
                    <Icon className="mb-4 h-5 w-5 text-primary" />
                    <h3 className="text-sm font-semibold">{title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase text-primary">Why it matters</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">The core POS flow, polished before anything extra.</h2>
          <p className="mt-4 text-muted-foreground">
            The product is intentionally narrow for beta: set up the business, sell reliably, keep inventory visible, and understand what happened today.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {benefits.map(([Icon, title, text]) => (
            <div key={title} className="rounded-lg border bg-card p-5 shadow-sm">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-5 font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="analytics" className="border-y border-border/70 bg-muted/35">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-sm font-medium uppercase text-primary">Reporting preview</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Analytics that refuse to invent answers.</h2>
            <p className="mt-4 text-muted-foreground">
              The dashboard can show sales totals, refunds, voids, transactions, average ticket, payment mix, top products, inventory status, and low-stock alerts when those records exist.
            </p>
          </div>
          <div className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {analyticsPreview.map(([Icon, title, text]) => (
                <div key={title} className="rounded-md border bg-background p-4">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="mt-3 text-sm font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{text}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-lg border bg-card p-6 shadow-xl shadow-primary/10 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Badge variant="secondary" className="mb-4">One plan</Badge>
              <h2 className="text-3xl font-semibold tracking-tight">Standard Plan</h2>
              <p className="mt-4 text-muted-foreground">
                One subscription for the current beta POS core. No Basic, Pro, Premium, per-user, per-location, annual, usage-based, or add-on pricing.
              </p>
              <div className="mt-6 flex items-end gap-2">
                <span className="text-5xl font-semibold tracking-tight">$199</span>
                <span className="pb-2 text-muted-foreground">MXN/month</span>
              </div>
              <Link to={primaryTarget} className={cn(buttonVariants({ size: "lg" }), "mt-7")}>
                {isAuthenticated ? "Manage setup" : "Start with Standard"}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-3">
              {included.map((item) => (
                <div key={item} className="flex items-start gap-3 rounded-md border bg-background px-4 py-3 text-sm">
                  <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <span>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="faq" className="border-t border-border/70 bg-muted/35">
        <div className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <p className="text-sm font-medium uppercase text-primary">FAQ</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">Clear expectations before signup.</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {faq.map((item) => (
              <div key={item.q} className="rounded-lg border bg-card p-5">
                <h3 className="font-semibold">{item.q}</h3>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.a}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
