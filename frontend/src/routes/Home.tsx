import { Link } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { copy } from "@/i18n/messages";
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

const setupIcons: LucideIcon[] = [Sparkles, CreditCard, Package, ShoppingCart];
const benefitIcons: LucideIcon[] = [Receipt, WifiOff, Package, LayoutDashboard];
const analyticsIcons: LucideIcon[] = [BarChart3, CreditCard, Package, Users];

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
            <span className="text-sm font-semibold tracking-tight">{copy.landing.brand}</span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex" aria-label="Landing navigation">
            <a href="#features" className="hover:text-foreground">{copy.landing.navBenefits}</a>
            <a href="#analytics" className="hover:text-foreground">{copy.landing.navAnalytics}</a>
            <a href="#pricing" className="hover:text-foreground">{copy.landing.navPricing}</a>
            <a href="#faq" className="hover:text-foreground">{copy.landing.navFaq}</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link to={secondaryTarget} className={buttonVariants({ variant: "ghost", size: "sm" })}>
              {isAuthenticated ? copy.landing.openRegister : copy.landing.login}
            </Link>
            <Link to={primaryTarget} className={buttonVariants({ size: "sm" })}>
              {isAuthenticated ? copy.landing.goToDashboard : copy.landing.startSetup}
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
              {copy.landing.badge}
            </Badge>
            <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-foreground sm:text-6xl lg:text-7xl">
              {copy.landing.heroTitle}
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-muted-foreground">
              {copy.landing.heroSubtitle}
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link to={primaryTarget} className={buttonVariants({ size: "lg" })}>
                {isAuthenticated ? copy.landing.continueSetup : copy.landing.createAccount}
                <ArrowRight className="h-4 w-4" />
              </Link>
              <a href="#pricing" className={buttonVariants({ variant: "outline", size: "lg" })}>
                {copy.landing.seePlan}
              </a>
            </div>
          </div>

          <div className="mt-12 rounded-lg border border-border/80 bg-card/95 p-3 shadow-2xl shadow-primary/10">
            <div className="grid gap-3 lg:grid-cols-[1.05fr_0.95fr]">
              <div className="rounded-md border bg-background p-4">
                <div className="mb-4 flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium uppercase text-muted-foreground">{copy.landing.today}</p>
                    <p className="text-lg font-semibold">{copy.landing.businessPerformance}</p>
                  </div>
                  <Badge variant="success">{copy.landing.realDataOnly}</Badge>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  {[
                    [copy.landing.metricNetSales, copy.landing.metricNetSalesEmpty],
                    [copy.landing.metricOrders, copy.landing.metricOrdersEmpty],
                    [copy.landing.metricAvgTicket, copy.landing.metricAvgTicketEmpty],
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
                      <p className="text-sm font-medium">{copy.landing.honestReportsTitle}</p>
                      <p className="text-sm text-muted-foreground">{copy.landing.honestReportsText}</p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {copy.landing.setupSteps.map((step, index) => {
                  const Icon = setupIcons[index];
                  return (
                  <div key={step.title} className="rounded-md border bg-background p-4">
                    <Icon className="mb-4 h-5 w-5 text-primary" />
                    <h3 className="text-sm font-semibold">{step.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{step.text}</p>
                  </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase text-primary">{copy.landing.whyEyebrow}</p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight">{copy.landing.whyTitle}</h2>
          <p className="mt-4 text-muted-foreground">
            {copy.landing.whyText}
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {copy.landing.benefits.map((benefit, index) => {
            const Icon = benefitIcons[index];
            return (
            <div key={benefit.title} className="rounded-lg border bg-card p-5 shadow-sm">
              <Icon className="h-5 w-5 text-primary" />
              <h3 className="mt-5 font-semibold">{benefit.title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">{benefit.text}</p>
            </div>
            );
          })}
        </div>
      </section>

      <section id="analytics" className="border-y border-border/70 bg-muted/35">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-sm font-medium uppercase text-primary">{copy.landing.analyticsEyebrow}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">{copy.landing.analyticsTitle}</h2>
            <p className="mt-4 text-muted-foreground">
              {copy.landing.analyticsText}
            </p>
          </div>
          <div className="rounded-lg border bg-card p-5 shadow-sm">
            <div className="grid gap-3 sm:grid-cols-2">
              {copy.landing.analyticsItems.map((item, index) => {
                const Icon = analyticsIcons[index];
                return (
                <div key={item.title} className="rounded-md border bg-background p-4">
                  <Icon className="h-4 w-4 text-primary" />
                  <h3 className="mt-3 text-sm font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.text}</p>
                </div>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      <section id="pricing" className="mx-auto max-w-5xl px-4 py-20 sm:px-6 lg:px-8">
        <div className="rounded-lg border bg-card p-6 shadow-xl shadow-primary/10 sm:p-8">
          <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
            <div>
              <Badge variant="secondary" className="mb-4">{copy.landing.onePlan}</Badge>
              <h2 className="text-3xl font-semibold tracking-tight">{copy.landing.standardPlan}</h2>
              <p className="mt-4 text-muted-foreground">
                {copy.landing.pricingText}
              </p>
              <div className="mt-6 flex items-end gap-2">
                <span className="text-5xl font-semibold tracking-tight">{copy.landing.price}</span>
                <span className="pb-2 text-muted-foreground">{copy.landing.priceCadence}</span>
              </div>
              <Link to={primaryTarget} className={cn(buttonVariants({ size: "lg" }), "mt-7")}>
                {isAuthenticated ? copy.landing.manageSetup : copy.landing.startWithStandard}
                <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
            <div className="grid gap-3">
              {copy.landing.included.map((item) => (
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
            <p className="text-sm font-medium uppercase text-primary">{copy.landing.faqEyebrow}</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">{copy.landing.faqTitle}</h2>
          </div>
          <div className="mt-10 grid gap-4 md:grid-cols-2">
            {copy.landing.faq.map((item) => (
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
