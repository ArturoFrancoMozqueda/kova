import { useEffect, useState, type FormEvent } from "react";
import { Search, Users } from "lucide-react";
import {
  usePermission,
  CUSTOMERS_MANAGE_PERMISSION,
  CUSTOMERS_HISTORY_PERMISSION,
} from "@/auth/permissions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { copy } from "@/i18n/messages";
import {
  customerHistory,
  listCustomers,
  saveCustomer,
  type Customer,
  type CustomerHistory,
} from "./api";

const t = copy.customersView;

const money = (amount: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(amount),
  );
export function CustomersView() {
  useDocumentTitle(t.title);
  const canManage = usePermission(CUSTOMERS_MANAGE_PERMISSION);
  const canHistory = usePermission(CUSTOMERS_HISTORY_PERMISSION);
  const [q, setQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [inactive, setInactive] = useState(false);
  const [rows, setRows] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Customer | null | undefined>(
    undefined,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [saving, setSaving] = useState(false);
  const [revision, setRevision] = useState(0);
  const [history, setHistory] = useState<CustomerHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void listCustomers(q, offset, inactive)
        .then((data) => {
          if (active) {
            setRows(data);
            setError("");
          }
        })
        .catch((e: unknown) => {
          if (active)
            setError(e instanceof Error ? e.message : t.loadError);
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [q, offset, inactive, revision]);
  const edit = (customer: Customer | null) => {
    setEditing(customer);
    setName(customer?.name ?? "");
    setEmail(customer?.email ?? "");
    setPhone(customer?.phone ?? "");
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");
    try {
      await saveCustomer(
        {
          name: name.trim(),
          email: email.trim() || null,
          phone: phone.trim() || null,
          is_active: editing?.is_active ?? true,
        },
        editing?.id,
      );
      setEditing(undefined);
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.saveError);
    } finally {
      setSaving(false);
    }
  };
  const showHistory = async (id: string, historyOffset = 0) => {
    setHistoryLoading(true);
    setError("");
    try {
      setHistory(await customerHistory(id, historyOffset));
    } catch (e) {
      setError(e instanceof Error ? e.message : t.historyError);
    } finally {
      setHistoryLoading(false);
    }
  };
  const toggleActive = async (customer: Customer) => {
    setSaving(true);
    try {
      await saveCustomer(
        {
          name: customer.name,
          email: customer.email,
          phone: customer.phone,
          is_active: !customer.is_active,
        },
        customer.id,
      );
      setRevision((n) => n + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.updateError);
    } finally {
      setSaving(false);
    }
  };
  return (
    <ViewLayout width="standard" className="space-y-6">
      <ViewHeader
        title={t.title}
        meta={t.subtitle}
        actions={canManage ? <Button onClick={() => edit(null)}>{t.newCustomer}</Button> : undefined}
      />
      {error && (
        <p
          role="alert"
          className="rounded-kova-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive-strong"
        >
          {error}
        </p>
      )}
      {editing !== undefined && canManage && (
        <Card>
          <CardContent className="p-5">
            <form
              onSubmit={(e) => void submit(e)}
              className="space-y-4"
              aria-label={t.form}
            >
              <h2 className="text-lg font-semibold">
                {editing ? t.editCustomer : t.newCustomer}
              </h2>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="space-y-1.5">
                  <Label htmlFor="customer-name">{t.name}</Label>
                  <Input
                    id="customer-name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={160}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customer-email">{t.email}</Label>
                  <Input
                    id="customer-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    maxLength={254}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="customer-phone">{t.phone}</Label>
                  <Input
                    id="customer-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    maxLength={30}
                    pattern="[+0-9 ()-]+"
                  />
                </div>
              </div>
              <p className="text-sm text-muted-foreground">{t.privacyNote}</p>
              <div className="flex flex-wrap gap-2">
                <Button type="submit" disabled={saving || !name.trim()}>
                  {saving ? t.saving : t.save}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={saving}
                  onClick={() => setEditing(undefined)}
                >
                  {t.cancel}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full max-w-md">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            aria-label={t.search}
            placeholder={t.searchPlaceholder}
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              setOffset(0);
            }}
            className="pl-9"
          />
        </div>
        <Label className="flex min-h-11 items-center gap-2">
          <input
            type="checkbox"
            checked={inactive}
            onChange={(e) => {
              setInactive(e.target.checked);
              setOffset(0);
            }}
            className="h-4 w-4"
          />
          {t.includeInactive}
        </Label>
      </div>
      {loading ? (
        <Card aria-busy="true">
          <p role="status" className="sr-only">{t.loading}</p>
          <CardContent className="divide-y p-0">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 p-4">
                <div className="space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
                <Skeleton className="h-9 w-28" />
              </div>
            ))}
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <ViewEmpty
          icon={q ? <Search className="h-6 w-6" /> : <Users className="h-6 w-6" />}
          title={q ? t.noResultsTitle : t.emptyTitle}
          body={q ? t.noResultsBody : t.emptyBody}
          primaryCta={!q && canManage ? { label: t.newCustomer, onClick: () => edit(null) } : undefined}
        />
      ) : (
        <Card>
          <ul className="divide-y">
            {rows.map((customer) => (
              <li
                key={customer.id}
                className="flex flex-wrap items-center justify-between gap-3 p-4"
              >
                <div className="min-w-0">
                  <p className="font-medium text-kova-ink">
                    {customer.name}
                    {!customer.is_active && (
                      <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                        {t.inactive}
                      </span>
                    )}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {[customer.email, customer.phone]
                      .filter(Boolean)
                      .join(" · ") || t.noContact}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {canHistory && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={historyLoading}
                      onClick={() => void showHistory(customer.id)}
                    >
                      {t.viewPurchases}
                    </Button>
                  )}
                  {canManage && (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={saving}
                        onClick={() => edit(customer)}
                      >
                        {t.edit}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={saving}
                        onClick={() => void toggleActive(customer)}
                      >
                        {customer.is_active ? t.deactivate : t.reactivate}
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {(offset > 0 || rows.length >= 100) && (
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={offset === 0 || loading}
            onClick={() => setOffset((n) => Math.max(0, n - 100))}
          >
            {t.previous}
          </Button>
          <Button
            variant="outline"
            disabled={rows.length < 100 || loading}
            onClick={() => setOffset((n) => n + 100)}
          >
            {t.next}
          </Button>
        </div>
      )}
      {history && (
        <Card>
          <section className="space-y-3 p-5" aria-label={t.history}>
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-lg font-semibold">
                {t.historyTitle(history.customer.name)}
              </h2>
              <Button variant="ghost" size="sm" onClick={() => setHistory(null)}>
                {t.close}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">{t.historyHint}</p>
            {history.purchases.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.historyEmpty}</p>
            ) : (
              <ul className="divide-y">
                {history.purchases.map((sale) => (
                  <li key={sale.id} className="flex justify-between gap-3 py-3">
                    <div>
                      <p className="text-sm">{new Date(sale.occurred_at).toLocaleString("es-MX")}</p>
                      <p className="text-xs text-muted-foreground">
                        {sale.status === "voided" ? t.saleVoided : t.saleCompleted}{" "}
                        · {sale.id.slice(0, 8)}
                      </p>
                    </div>
                    <div className="text-right tabular-nums">
                      <p className="font-medium">{money(sale.total_amount)}</p>
                      {Number(sale.refunded_amount) > 0 && (
                        <p className="text-sm text-muted-foreground">
                          {t.refunded(money(sale.refunded_amount))}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
            {(history.offset > 0 || history.has_more) && (
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={history.offset === 0 || historyLoading}
                  onClick={() =>
                    void showHistory(
                      history.customer.id,
                      Math.max(0, history.offset - history.limit),
                    )
                  }
                >
                  {t.olderPurchases}
                </Button>
                <Button
                  variant="outline"
                  disabled={!history.has_more || historyLoading}
                  onClick={() =>
                    void showHistory(
                      history.customer.id,
                      history.offset + history.limit,
                    )
                  }
                >
                  {t.morePurchases}
                </Button>
              </div>
            )}
          </section>
        </Card>
      )}
    </ViewLayout>
  );
}
