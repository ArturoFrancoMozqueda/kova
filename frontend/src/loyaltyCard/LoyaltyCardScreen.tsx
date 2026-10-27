import { useRef, useState } from "react";
import { ArrowRight, CheckCircle2, ChevronDown, Copy, Gift, RefreshCw, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Reward } from "@/loyalty/rewards/api";

export type PublicLoyaltyCardData = {
  business_name: string;
  branch_name: string;
  balance: number;
  adjustments_pending: boolean;
  policy: { enabled: boolean; spend_amount: string | null; points_per_step: number | null };
  expires_at: string;
  catalog_path: string | null;
  reward?: Reward | null;
  member_code?: string | null;
  member_qr_data_url?: string | null;
};
const points = (amount: number) => amount.toLocaleString("es-MX");
const money = (amount: string) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(amount));

export function LoyaltyCardScreen({ data, loading = false, error = "", missing = false, accessMode = "link", onRefresh }: {
  data: PublicLoyaltyCardData | null; loading?: boolean; error?: string; missing?: boolean; accessMode?: "link" | "device"; onRefresh: () => void;
}) {
  useDocumentTitle(data ? `Tu tarjeta · ${data.business_name}` : "Tu tarjeta de lealtad");
  const [copyNotice, setCopyNotice] = useState("");
  const codeInput = useRef<HTMLInputElement>(null);
  const memberCode = typeof data?.member_code === "string" && data.member_code.trim() ? data.member_code : null;
  const memberQr = memberCode && typeof data?.member_qr_data_url === "string" && data.member_qr_data_url.length <= 32768 && /^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(data.member_qr_data_url) ? data.member_qr_data_url : null;
  const readyReward = Boolean(data?.reward?.enabled && !data.adjustments_pending && data.balance >= data.reward.points_cost);
  const copyCode = async () => {
    if (!memberCode) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(memberCode);
      setCopyNotice("Número copiado. Compártelo con el equipo al pagar.");
    } catch {
      codeInput.current?.focus(); codeInput.current?.select();
      setCopyNotice("Número seleccionado. Cópialo y compártelo con el equipo al pagar.");
    }
  };
  const catalogPath = data?.catalog_path && /^\/catalogo\/[^/?#]+$/.test(data.catalog_path) ? data.catalog_path : null;
  return <main className="min-h-screen bg-[#FAFAF7] px-4 py-6 text-kova-ink sm:py-10">
    <div className="mx-auto max-w-md space-y-5">
      <header>
        <p className="flex items-center gap-2 text-xs font-medium text-kova-muted"><Gift className="h-4 w-4 text-kova-blue" aria-hidden="true" />Tu tarjeta</p>
        {data && <><h1 className="mt-3 line-clamp-2 text-xl font-semibold leading-tight tracking-tight sm:text-2xl" title={data.business_name}>{data.business_name}</h1><p className="mt-1.5 truncate text-xs text-kova-muted" title={data.branch_name}>{data.branch_name}</p></>}
      </header>
      {missing ? <section className="rounded-3xl border border-kova-border bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">Tu tarjeta comienza en el negocio</h1>
        <p className="mt-3 text-sm leading-relaxed text-kova-muted">Pide al equipo el enlace de tu tarjeta digital. Aquí podrás consultar los puntos de tus compras.</p>
      </section> : loading ? <section aria-busy="true" className="rounded-3xl border border-kova-border bg-white p-8"><h1 className="text-xl font-semibold">Tu tarjeta de lealtad</h1><p role="status" className="mt-3 text-sm text-kova-muted">Consultando tus puntos…</p></section> : error ? <section className="rounded-3xl border border-kova-border bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold tracking-tight">No pudimos abrir tu tarjeta</h1>
        <p role="alert" className="mt-3 text-sm leading-relaxed text-kova-muted">{error}</p>
        <Button type="button" variant="outline" className="mt-5" onClick={onRefresh}>Volver a intentar</Button>
      </section> : data && <>
        <section aria-label="Tu saldo de lealtad" className="relative isolate flex aspect-[1.58] min-h-44 flex-col justify-between overflow-hidden rounded-[1.5rem] bg-kova-ink p-5 text-white shadow-[0_12px_30px_-16px_rgba(15,17,23,0.45)] sm:p-6">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top_right,rgba(53,99,208,0.35),transparent_65%)]" aria-hidden="true" />
          <div className="pointer-events-none absolute -right-14 -top-20 -z-10 h-64 w-64 rounded-full border border-white/10" aria-hidden="true" />
          <div className="pointer-events-none absolute -bottom-28 -right-6 -z-10 h-56 w-56 rounded-full border border-white/10" aria-hidden="true" />
          <div className="flex items-center justify-between gap-3"><p className="text-[10px] font-medium uppercase tracking-[0.2em] text-white/80">Tarjeta de lealtad</p><Gift className="h-5 w-5 text-white/80" aria-hidden="true" /></div>
          <div className="flex flex-wrap items-baseline gap-x-2 py-3"><output aria-label="Tus puntos" className="max-w-full break-all text-5xl font-semibold leading-none tracking-tight tabular-nums sm:text-6xl">{points(data.balance)}</output><span className="text-base text-white/80">{data.balance === 1 ? "punto" : "puntos"}</span></div>
          <div className="flex items-center justify-between gap-3 border-t border-white/15 pt-3"><p className="flex items-center gap-2 text-[11px] text-white/85"><span className={`h-1.5 w-1.5 shrink-0 rounded-full ${data.adjustments_pending ? "bg-amber-300" : data.policy.enabled ? "bg-[#A9C6FF]" : "bg-white/50"}`} aria-hidden="true" />{data.adjustments_pending ? "Saldo en revisión" : data.policy.enabled ? "Acumulación activa" : "Acumulación pausada por el negocio"}</p><span className="text-[10px] tracking-wide text-white/60" aria-hidden="true">KOVA</span></div>
        </section>
        {data.reward?.enabled && <section aria-label="Tu próxima recompensa" className="space-y-2 rounded-xl border border-kova-border bg-white p-4 text-sm">
          {readyReward && <p className="flex items-center gap-1.5 text-xs font-medium text-kova-blue"><CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />Disponible para ti</p>}
          <p className="font-semibold">{data.reward.title}</p><p className="text-xs text-kova-muted">{points(data.reward.points_cost)} puntos por {money(data.reward.discount_amount)} MXN de descuento.</p>
          <p className="text-xs tabular-nums text-kova-muted">{points(Math.max(0, Math.min(data.balance, data.reward.points_cost)))} de {points(data.reward.points_cost)} puntos</p>
          <progress aria-label="Progreso de tu recompensa" className="h-1.5 w-full appearance-none overflow-hidden rounded-full border-0 bg-kova-mist [&::-webkit-progress-bar]:rounded-full [&::-webkit-progress-bar]:bg-kova-mist [&::-webkit-progress-value]:rounded-full [&::-webkit-progress-value]:bg-kova-blue [&::-moz-progress-bar]:bg-kova-blue" max={data.reward.points_cost} value={Math.max(0, Math.min(data.balance, data.reward.points_cost))} />
          <p className="text-xs">{data.adjustments_pending ? "Consulta tu saldo con el equipo antes de canjear." : readyReward ? "Solicítala al equipo para aplicarla al completar tu compra." : `Te faltan ${points(data.reward.points_cost - data.balance)} puntos.`}</p>
        </section>}
        {!data.reward?.enabled && <p className="text-sm text-kova-muted">Consulta tus beneficios con el equipo.</p>}
        {memberCode && <section aria-label="Presentar tu tarjeta" className="rounded-xl border border-kova-border bg-white px-4 pt-4">
          <div className="flex items-center gap-4 pb-3">
            <div className="min-w-0 flex-1"><h2 className="text-sm font-semibold">Preséntala al pagar</h2><p className="mt-1.5 text-xs leading-relaxed text-kova-muted">{memberQr ? "Muéstrala al equipo para identificar tu tarjeta." : "El equipo puede identificar tu tarjeta con su número."}</p></div>
            {memberQr && <img src={memberQr} width={112} height={112} alt="Tu tarjeta para presentar en caja" className="h-28 w-28 shrink-0" />}
          </div>
          <details className="group border-t border-kova-border">
            <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 rounded-lg text-xs font-medium text-kova-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue [&::-webkit-details-marker]:hidden">Usar número de tarjeta<ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
            <div className="pb-4"><label htmlFor="loyalty-member-code" className="text-xs text-kova-muted">Número de tarjeta</label>
              <div className="mt-1 flex items-center gap-2"><input ref={codeInput} id="loyalty-member-code" readOnly value={memberCode} className="min-h-11 min-w-0 flex-1 rounded-lg border border-kova-border bg-kova-mist px-2 font-mono text-xs text-kova-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue sm:text-sm" />
                <Button type="button" variant="ghost" size="icon" aria-label="Copiar número de tarjeta" onClick={() => void copyCode()}><Copy className="h-4 w-4" aria-hidden="true" /></Button></div>
              {copyNotice && <p role="status" className="mt-2 text-xs text-kova-muted">{copyNotice}</p>}
            </div>
          </details>
        </section>}
        <div className="space-y-2.5">
          {catalogPath && <a href={catalogPath} className="flex min-h-12 items-center justify-between gap-3 rounded-xl bg-kova-blue px-4 py-3 text-sm font-medium text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue"><span className="inline-flex items-center gap-2"><ShoppingBag className="h-4 w-4" aria-hidden="true" />Ver menú del negocio</span><ArrowRight className="h-4 w-4" aria-hidden="true" /></a>}
          <Button type="button" variant="ghost" className="w-full text-kova-muted" onClick={onRefresh}><RefreshCw className="mr-2 h-4 w-4" aria-hidden="true" />Actualizar puntos</Button>
        </div>
        {data.adjustments_pending && <p role="status" className="rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-xs leading-relaxed text-warning-foreground">Hay devoluciones o anulaciones pendientes. El saldo puede cambiar; consulta al equipo antes de canjear.</p>}
        {data.balance < 0 && <p className="text-xs leading-relaxed text-kova-muted">Las devoluciones o anulaciones redujeron tus puntos. El negocio puede ayudarte a revisar tu saldo.</p>}
        <details className="group border-t border-kova-border">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg py-3 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue [&::-webkit-details-marker]:hidden">Cómo funciona tu tarjeta<ChevronDown className="h-4 w-4 text-kova-muted transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <div className="space-y-5 pb-3 pt-1 text-xs leading-relaxed text-kova-muted">
            <div><h2 className="font-semibold text-kova-ink">Tu regla de acumulación</h2><p className="mt-1.5">{data.policy.spend_amount && data.policy.points_per_step != null
              ? `En cada compra elegible, sumas ${points(data.policy.points_per_step)} ${data.policy.points_per_step === 1 ? "punto" : "puntos"} por cada tramo completo de ${money(data.policy.spend_amount)} MXN, según la regla vigente al comprar.`
              : "Consulta con el equipo cómo sumar puntos."}</p>{data.policy.spend_amount && data.policy.points_per_step != null && <p className="mt-1.5">Los importes sobrantes no se suman entre compras.</p>}{!data.policy.enabled && <p className="mt-1.5">La acumulación está pausada. Tus puntos registrados siguen visibles.</p>}</div>
            <div><h2 className="font-semibold text-kova-ink">Al comprar y canjear</h2><p className="mt-1.5">Pide que registren la venta a tu nombre. Las compras recientes pueden tardar en reflejarse.</p><p className="mt-1.5">{data.reward?.enabled ? "La recompensa se confirma en caja al completar tu compra. Esta tarjeta no funciona como medio de pago." : "Consulta los beneficios con el equipo. El canje se revisa en el negocio; esta tarjeta no aplica descuentos ni funciona como medio de pago."}</p></div>
            <div><h2 className="font-semibold text-kova-ink">Vigencia y privacidad</h2><p className="mt-1.5">{accessMode === "device" ? `Puedes volver a consultar esta tarjeta desde este navegador hasta el ${new Date(data.expires_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}. Si borras sus datos o cambias de dispositivo, puedes perder el acceso; pide al equipo que te comparta un enlace.` : `El enlace vence el ${new Date(data.expires_at).toLocaleDateString("es-MX", { day: "numeric", month: "long", year: "numeric" })}. Guárdalo en tus favoritos y compártelo sólo con quien quieras que consulte tus puntos.`}</p><p className="mt-1.5 break-words">Negocio: {data.business_name}. Sucursal: {data.branch_name}.</p></div>
          </div>
        </details>
      </>}
      <footer className="pt-1 text-center text-[10px] text-kova-muted">Con tecnología de <span className="font-semibold text-kova-ink">Kova</span></footer>
    </div>
  </main>;
}
