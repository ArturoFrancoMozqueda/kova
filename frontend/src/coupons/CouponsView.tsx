import { useId, useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TicketPercent } from "lucide-react";

import { useOptionalAuth } from "@/auth/useAuth";
import { ORDER_DISCOUNT_PERMISSION, usePermission } from "@/auth/permissions";
import { hasPlanFeature } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { resolveUserFacingError } from "@/lib/apiError";
import { formatMoney } from "@/orders/format";
import { createCoupon, listCoupons, updateCoupon, type Coupon, type CouponKind } from "./api";

const COUPONS_KEY = ["coupons"] as const;
const dateOf = (value: string | null) => value ? new Date(value).toLocaleDateString("es-MX", { dateStyle: "medium" }) : null;

function describe(coupon: Coupon): string {
  const value = coupon.kind === "percent" ? `${Number(coupon.value)}% de descuento` : `${formatMoney(coupon.value)} de descuento`;
  const parts = [value];
  if (coupon.min_purchase) parts.push(`en compras desde ${formatMoney(coupon.min_purchase)}`);
  return parts.join(" ");
}

function limits(coupon: Coupon): string {
  const parts = [coupon.max_uses ? `${coupon.uses} de ${coupon.max_uses} usos` : `${coupon.uses} usos`];
  if (coupon.max_uses_per_customer) parts.push(`${coupon.max_uses_per_customer} por cliente`);
  const from = dateOf(coupon.starts_at);
  const until = dateOf(coupon.ends_at);
  if (from || until) parts.push(from && until ? `del ${from} al ${until}` : from ? `desde el ${from}` : `hasta el ${until}`);
  return parts.join(" · ");
}

/** Managers create promotion codes; any cashier applies them at the counter. */
export default function CouponsView() {
  useDocumentTitle("Cupones");
  const auth = useOptionalAuth();
  const canManage = usePermission(ORDER_DISCOUNT_PERMISSION);
  const included = hasPlanFeature(auth?.state.status === "authenticated" ? auth.state.commercialAccess : undefined, "loyalty");
  const queryClient = useQueryClient();
  const { data, isPending, isError, refetch } = useQuery({ queryKey: COUPONS_KEY, queryFn: listCoupons });
  const [form, setForm] = useState({ code: "", kind: "percent" as CouponKind, value: "", min: "", starts: "", ends: "", maxUses: "", perCustomer: "", description: "" });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const ids = { code: useId(), kind: useId(), value: useId(), min: useId(), starts: useId(), ends: useId(), maxUses: useId(), perCustomer: useId(), description: useId() };

  const refresh = () => queryClient.invalidateQueries({ queryKey: COUPONS_KEY });
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (saving) return;
    setSaving(true); setError(null);
    try {
      await createCoupon({
        code: form.code.trim(), kind: form.kind, value: form.value,
        description: form.description.trim() || null,
        min_purchase: form.min || null,
        starts_at: form.starts ? new Date(`${form.starts}T00:00:00`).toISOString() : null,
        ends_at: form.ends ? new Date(`${form.ends}T23:59:59`).toISOString() : null,
        max_uses: form.maxUses ? Number(form.maxUses) : null,
        max_uses_per_customer: form.perCustomer ? Number(form.perCustomer) : null,
      });
      setForm({ code: "", kind: "percent", value: "", min: "", starts: "", ends: "", maxUses: "", perCustomer: "", description: "" });
      await refresh();
    } catch (caught) {
      setError(resolveUserFacingError(caught, "No pudimos crear el cupón. Revisa los datos e intenta de nuevo."));
    } finally { setSaving(false); }
  };
  const toggle = async (coupon: Coupon) => {
    setError(null);
    try { await updateCoupon(coupon.id, { version: coupon.version, is_active: !coupon.is_active }); await refresh(); }
    catch (caught) { setError(resolveUserFacingError(caught, "No pudimos actualizar el cupón.")); }
  };
  const set = (field: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [field]: event.target.value }));

  return (
    <ViewLayout className="space-y-6">
      <ViewHeader title="Cupones" meta="Crea códigos de promoción con vigencia y límites. En Caja, cualquier cajero los aplica y Kova calcula el descuento." />
      {!included ? <PlanFeatureNotice /> : null}
      {error ? <p role="alert" className="rounded-kova-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-strong">{error}</p> : null}
      {canManage && included ? (
        <Card><CardContent className="pt-6">
          <form onSubmit={(event) => void submit(event)} className="grid gap-4 sm:grid-cols-2">
            <div><Label htmlFor={ids.code}>Código</Label><Input id={ids.code} required maxLength={32} placeholder="VERANO10" value={form.code} onChange={set("code")} /></div>
            <div className="grid grid-cols-[1fr_8rem] gap-2">
              <div><Label htmlFor={ids.kind}>Tipo</Label><Select id={ids.kind} value={form.kind} onChange={(event) => setForm((current) => ({ ...current, kind: event.target.value as CouponKind }))}><option value="percent">Porcentaje</option><option value="amount">Monto fijo</option></Select></div>
              <div><Label htmlFor={ids.value}>{form.kind === "percent" ? "%" : "Monto"}</Label><Input id={ids.value} required type="number" inputMode="decimal" min="0.01" max={form.kind === "percent" ? 100 : undefined} step="0.01" value={form.value} onChange={set("value")} /></div>
            </div>
            <div><Label htmlFor={ids.min}>Compra mínima (opcional)</Label><Input id={ids.min} type="number" inputMode="decimal" min="0" step="0.01" value={form.min} onChange={set("min")} /></div>
            <div><Label htmlFor={ids.description}>Descripción (opcional)</Label><Input id={ids.description} maxLength={160} placeholder="Promo de verano" value={form.description} onChange={set("description")} /></div>
            <div><Label htmlFor={ids.starts}>Desde (opcional)</Label><Input id={ids.starts} type="date" value={form.starts} onChange={set("starts")} /></div>
            <div><Label htmlFor={ids.ends}>Hasta (opcional)</Label><Input id={ids.ends} type="date" min={form.starts || undefined} value={form.ends} onChange={set("ends")} /></div>
            <div><Label htmlFor={ids.maxUses}>Usos en total (opcional)</Label><Input id={ids.maxUses} type="number" inputMode="numeric" min="1" step="1" value={form.maxUses} onChange={set("maxUses")} /></div>
            <div><Label htmlFor={ids.perCustomer}>Usos por cliente (opcional)</Label><Input id={ids.perCustomer} type="number" inputMode="numeric" min="1" step="1" value={form.perCustomer} onChange={set("perCustomer")} aria-describedby={`${ids.perCustomer}-hint`} /><p id={`${ids.perCustomer}-hint`} className="mt-1 text-xs text-muted-foreground">Con límite por cliente, Caja pide elegir al cliente.</p></div>
            <div className="sm:col-span-2"><Button type="submit" disabled={saving}>Crear cupón</Button></div>
          </form>
        </CardContent></Card>
      ) : null}
      {isPending ? <Skeleton className="h-40 w-full" /> : isError ? <ViewError message="No pudimos cargar los cupones." onRetry={() => void refetch()} retryLabel="Reintentar" />
        : data && data.length === 0 ? <ViewEmpty icon={<TicketPercent className="h-6 w-6" />} title="Aún no hay cupones" body={canManage ? "Crea tu primer código de promoción con el formulario." : "Gerencia puede crear códigos de promoción para Caja."} />
        : (
          <ul className="space-y-3" aria-label="Cupones">
            {(data ?? []).map((coupon) => (
              <li key={coupon.id}><Card><CardContent className="flex flex-wrap items-center justify-between gap-3 py-4">
                <div className="min-w-0">
                  <p className="font-mono text-lg font-semibold">{coupon.code}{!coupon.is_active ? <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">Pausado</span> : null}</p>
                  <p className="text-sm">{describe(coupon)}{coupon.description ? ` · ${coupon.description}` : ""}</p>
                  <p className="text-xs text-muted-foreground">{limits(coupon)}</p>
                </div>
                {canManage && included ? <Button variant="outline" size="sm" onClick={() => void toggle(coupon)}>{coupon.is_active ? "Pausar" : "Reactivar"}</Button> : null}
              </CardContent></Card></li>
            ))}
          </ul>
        )}
    </ViewLayout>
  );
}
