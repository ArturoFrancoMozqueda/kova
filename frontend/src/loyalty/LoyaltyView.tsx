import { hasPlanFeature } from "@/billing/entitlements";
import { PlanFeatureNotice } from "@/billing/PlanFeatureNotice";
import { useEffect, useState, type FormEvent } from "react";
import { CircleMinus, CirclePlus } from "lucide-react";
import { InitialsAvatar } from "@/components/visual";
import { RewardProgress } from "./RewardProgress";
import type { Reward } from "./rewards/api";
import { useSearchParams, Link } from "react-router-dom";
import { resolveUserFacingError } from "@/lib/apiError";
import { useAuth } from "@/auth/useAuth";
import {
  OperationsSession,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { useOperationsPanel } from "@/automations/useOperationsPanel";
import { Button } from "@/components/ui/button";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewError, ViewPermissionDenied } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type { Customer } from "@/customers/api";
import { DigitalCardShare } from "./DigitalCardShare";
import { ProgramWizard } from "./ProgramWizard";

type LoyaltyPolicy = {
  enabled: boolean;
  spend_amount: string | null;
  points_per_step: number | null;
  version: number;
};
type LoyaltyAccount = {
  customer_id: string;
  customer_name: string;
  balance: number;
};
type LoyaltyOverview = {
  policy: LoyaltyPolicy;
  accounts: LoyaltyAccount[];
  accounts_has_more: boolean;
};
type LoyaltyEntry = {
  id: string;
  kind: "accrual" | "refund" | "void" | "redemption" | "reward_return";
  points: number;
  sale_order_id: string | null;
  benefit: string | null;
  created_at: string;
};
type LoyaltyLedger = LoyaltyAccount & {
  adjustments_pending: boolean;
  entries: LoyaltyEntry[];
  has_more: boolean;
};
const kinds = {
  accrual: "Acumulación por venta",
  refund: "Reversión por devolución",
  void: "Reversión por anulación",
  redemption: "Canje registrado",
  reward_return: "Puntos restituidos",
};
const fieldClass =
  "mt-1 min-h-11 w-full rounded-lg border border-input bg-white p-3";
const buttonClass = "h-auto min-h-11 whitespace-normal";
const points = (value: number) => new Intl.NumberFormat("es-MX").format(value);
export default function LoyaltyView() {
  useDocumentTitle("Lealtad de clientes");
  const { state } = useAuth();
  if (state.status === "authenticated" && state.user.role !== "owner")
    return (
      <ViewPermissionDenied
        title="Lealtad administrada por el dueño"
        description="El dueño del negocio configura la acumulación y registra los canjes de puntos."
      />
    );
  return (
    <OperationsSession>
      {(identity) => <LoyaltyWorkspace identity={identity} canManageProgram={hasPlanFeature(state.status === "authenticated" ? state.commercialAccess : undefined, "loyalty")} />}
    </OperationsSession>
  );
}
function LoyaltyWorkspace({ identity, canManageProgram }: { identity: WorkspaceIdentity; canManageProgram: boolean }) {
  const [params] = useSearchParams();
  const [offset, setOffset] = useState(0);
  const panel = useOperationsPanel<LoyaltyOverview>(
    "/api/v1/loyalty",
    identity,
    `?limit=50&offset=${offset}`,
  );
  const { request } = panel;
  const customersRequest = useOperationsRequest("/api/v1/customers", identity);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerAttempt, setCustomerAttempt] = useState(0);
  const [customerId, setCustomerId] = useState(() => params.get("customerId") ?? "");
  const [ledger, setLedger] = useState<LoyaltyLedger | null>(null);
  const [reward, setReward] = useState<Reward | null>(null);
  const [ledgerError, setLedgerError] = useState("");
  const [ledgerOffset, setLedgerOffset] = useState(0);
  const [ledgerRevision, setLedgerRevision] = useState(0);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [redeemPoints, setRedeemPoints] = useState("");
  const [benefit, setBenefit] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    setCustomers([]);
    setCustomerError("");
    setCustomerLoading(true);
    const timer = window.setTimeout(() => {
      void customersRequest<Customer[]>(`?q=${encodeURIComponent(search)}`)
        .then((rows) => {
          if (active) {
            setCustomers(rows);
            setCustomerError("");
          }
        })
        .catch(() => {
          if (active) {
            setCustomers([]);
            setCustomerError(
              "No pudimos buscar clientes. Vuelve a intentar para consultar resultados actuales.",
            );
          }
        })
        .finally(() => { if (active) setCustomerLoading(false); });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [customersRequest, search, customerAttempt]);
  useEffect(() => {
    let active = true;
    setLedger(null);
    setLedgerError("");
    if (customerId)
      void request<LoyaltyLedger>(
        `/customers/${encodeURIComponent(customerId)}?limit=50&offset=${ledgerOffset}`,
      )
        .then((result) => {
          if (active) setLedger(result);
        })
        .catch((e: unknown) => {
          if (active)
            setLedgerError(
              resolveUserFacingError(e, "No pudimos consultar los puntos del cliente."),
            );
        });
    return () => {
      active = false;
    };
  }, [customerId, ledgerOffset, ledgerRevision, request]);
  const chooseCustomer = (id: string) => {
    setCustomerId(id);
    setLedgerOffset(0);
    setRedeemOpen(false);
    setConfirmed(false);
    setRedeemPoints("");
    setBenefit("");
  };
  const redeem = async (event: FormEvent) => {
    event.preventDefault();
    if (!ledger || !confirmed) return;
    if (
      await panel.mutate(
        `/customers/${ledger.customer_id}/redeem`,
        "POST",
        {
          points: Number(redeemPoints),
          expected_balance: ledger.balance,
          benefit: benefit.trim(),
          confirmed: true,
        },
        "Canje registrado en puntos. El beneficio y cualquier descuento se gestionan por separado.",
      )
    ) {
      setRedeemOpen(false);
      setConfirmed(false);
      setRedeemPoints("");
      setBenefit("");
      setLedgerRevision((value) => value + 1);
    } else {
      setConfirmed(false);
      setLedgerRevision((value) => value + 1);
    }
  };
  const canRedeem =
    ledger &&
    !ledger.adjustments_pending &&
    Number.isInteger(Number(redeemPoints)) &&
    Number(redeemPoints) > 0 &&
    Number(redeemPoints) <= ledger.balance &&
    benefit.trim().length > 0 &&
    confirmed;
  return (
    <ViewLayout className="space-y-6">
      <ViewHeader
        eyebrow="Relación con clientes"
        title="Lealtad de clientes"
        meta="Consulta puntos respaldados por ventas y conserva el historial de cada canje."
        actions={<Button variant="outline" disabled={panel.busy || !panel.online || !panel.data} onClick={() => { void panel.mutate("/process", "POST", {}, "Movimientos revisados con las ventas, devoluciones y anulaciones disponibles.").then(ok => { if (ok) setLedgerRevision(v => v + 1); }); }}>Actualizar movimientos de puntos</Button>}

      />
      <p className="max-w-3xl text-sm text-kova-muted">
        Los puntos no son dinero ni saldo a favor. Las recompensas de caja se
        confirman con la venta; los canjes manuales sólo registran un débito y
        deben entregarse por separado.
      </p>
      {panel.error && (
        <ViewError
          message={panel.error}
          onRetry={() => void panel.load()}
          retryLabel="Consultar versión actual"
        />
      )}
      {panel.notice && (
        <p role="status" className="rounded-xl bg-kova-mist p-4">
          {panel.notice}
        </p>
      )}
      {!canManageProgram && <PlanFeatureNotice>Los puntos ya acumulados se conservan y pueden canjearse. Para configurar el programa o acumular nuevos puntos necesitas Gestión.</PlanFeatureNotice>}
      {panel.loading && <p role="status">Consultando lealtad…</p>}
      <section className="space-y-4" aria-label="Puntos por cliente">
        {Boolean(panel.data?.policy.version || panel.data?.accounts.length) && <h2 className="text-xl font-semibold">Puntos por cliente</h2>}
        {panel.data?.accounts.length === 0 && Boolean(panel.data.policy.version) && (
          <p className="rounded-2xl border border-kova-border bg-white p-6 text-sm text-kova-muted">
            No hay movimientos de puntos en esta página. Configura la regla y
            registra ventas con cliente para comenzar.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {panel.data?.accounts.map((row) => (
            <button
              key={row.customer_id}
              type="button"
              className="min-w-0 space-y-2 rounded-2xl border border-kova-border bg-white p-5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue"
              onClick={() => chooseCustomer(row.customer_id)}
            >
              <span className="flex min-w-0 items-center gap-2 font-medium">
                <InitialsAvatar name={row.customer_name} size="sm" />
                <span className="min-w-0 break-words">{row.customer_name}</span>
              </span>
              <span className="block text-2xl font-semibold">
                {points(row.balance)} puntos
              </span>
              <RewardProgress reward={reward} balance={row.balance} size="sm" />
              <span className="block text-xs text-kova-muted">
                Consultar movimientos
              </span>
            </button>
          ))}
        </div>
        {(offset > 0 || panel.data?.accounts_has_more) && (        <nav
          aria-label="Páginas de cuentas de lealtad"
          className="flex flex-wrap gap-3"
        >
          <Button
            className={buttonClass}
            variant="outline"
            disabled={offset === 0 || panel.loading}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Cuentas anteriores
          </Button>
          <Button
            className={buttonClass}
            variant="outline"
            disabled={!panel.data?.accounts_has_more || panel.loading}
            onClick={() => setOffset((value) => value + 50)}
          >
            Más cuentas
          </Button>
        </nav>)}
      </section>
      {canManageProgram && <ProgramWizard identity={identity} onSaved={() => void panel.load()} onReward={setReward} />}
      <section
        className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
        aria-label="Consultar cliente"
      >
        <h2 className="text-xl font-semibold">Consulta individual</h2>
        <label className="block text-sm">
          Buscar cliente para consultar puntos
          <input
            className={fieldClass}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        {customerLoading && <p role="status" className="text-sm text-kova-muted">Buscando clientes…</p>}
        {customerError && <div className="space-y-2"><p role="alert">{customerError}</p><Button type="button" variant="outline" onClick={() => setCustomerAttempt(value => value + 1)}>Volver a buscar clientes</Button></div>}
        <label className="block text-sm">
          Cliente del programa
          <select
            aria-label="Cliente del programa"
            className={fieldClass}
            value={customerId}
            disabled={customerLoading || Boolean(customerError)}
            onChange={(event) => chooseCustomer(event.target.value)}
          >
            <option value="">Selecciona un cliente registrado</option>
            {customerId && !customers.some(customer => customer.id === customerId) && <option value={customerId} disabled>{ledger?.customer_name ?? "Cliente seleccionado"}</option>}
            {customers.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
      </section>
      {ledgerError && (
        <ViewError
          message={ledgerError}
          onRetry={() => setLedgerRevision((value) => value + 1)}
          retryLabel="Consultar puntos"
        />
      )}
      {customerId && !ledger && !ledgerError && (
        <p role="status">Consultando movimientos del cliente…</p>
      )}
      {ledger && (
        <section
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          aria-label="Movimientos del cliente"
        >
          <div className="flex min-w-0 items-center gap-3">
            <InitialsAvatar name={ledger.customer_name} size="lg" />
            <h2 className="min-w-0 break-words text-xl font-semibold">
              {ledger.customer_name}
            </h2>
          </div>
          <output
            aria-label="Saldo de puntos"
            className="block text-3xl font-semibold"
          >
            {points(ledger.balance)} puntos
          </output>
          <RewardProgress reward={reward} balance={ledger.balance} />
          {canManageProgram && <DigitalCardShare key={ledger.customer_id} identity={identity} customerId={ledger.customer_id} online={panel.online} disabled={panel.busy} />}
          {ledger.adjustments_pending && (
            <p role="status" className="text-sm text-warning-strong">
              Procesa devoluciones o anulaciones pendientes antes de canjear.
              Usa Actualizar movimientos de puntos.
            </p>
          )}
          {ledger.balance < 0 && (
            <p className="text-sm text-warning-strong">
              Las devoluciones o anulaciones dejaron un saldo negativo. No se
              pueden registrar nuevos canjes hasta recuperar puntos suficientes.
            </p>
          )}
          <Button
            className={buttonClass}
            variant="outline"
            disabled={
              ledger.balance <= 0 ||
              ledger.adjustments_pending ||
              panel.busy ||
              !panel.online
            }
            onClick={() => {
              setRedeemOpen((value) => !value);
              setConfirmed(false);
            }}
          >
            Preparar canje de puntos
          </Button>
          {ledger.entries.length === 0 && (
            <p className="text-sm text-kova-muted">
              Este cliente todavía no tiene movimientos de puntos.
            </p>
          )}
          <ol className="space-y-3">
            {ledger.entries.map((entry) => (
              <li
                key={entry.id}
                className="min-w-0 space-y-2 rounded-xl bg-kova-mist p-4"
              >
                <div className="flex flex-wrap justify-between gap-2">
                  <p className="flex items-center gap-2 font-medium">
                    {entry.points >= 0 ? (
                      <CirclePlus className="h-4 w-4 shrink-0 text-kova-growth" aria-hidden="true" />
                    ) : (
                      <CircleMinus className="h-4 w-4 shrink-0 text-kova-danger" aria-hidden="true" />
                    )}
                    {kinds[entry.kind]}
                  </p>
                  <p className="font-semibold tabular-nums">
                    {entry.points > 0 ? "+" : ""}
                    {points(entry.points)} puntos
                  </p>
                </div>
                <p className="text-xs text-kova-muted">
                  {new Date(entry.created_at).toLocaleString("es-MX")}
                </p>
                {entry.benefit && (
                  <p className="break-words text-sm">
                    Beneficio descrito por el equipo: {entry.benefit}
                  </p>
                )}
                {entry.sale_order_id && (
                  <Link to={`/orders/${encodeURIComponent(entry.sale_order_id)}`} className="inline-flex min-h-11 items-center text-xs font-medium text-kova-blue underline underline-offset-4">Ver venta de origen</Link>
                )}
              </li>
            ))}
          </ol>
          <nav
            aria-label="Páginas de movimientos de lealtad"
            className="flex flex-wrap gap-3"
          >
            <Button
              className={buttonClass}
              variant="outline"
              disabled={ledgerOffset === 0}
              onClick={() =>
                setLedgerOffset((value) => Math.max(0, value - 50))
              }
            >
              Movimientos anteriores
            </Button>
            <Button
              className={buttonClass}
              variant="outline"
              disabled={!ledger.has_more}
              onClick={() => setLedgerOffset((value) => value + 50)}
            >
              Más movimientos
            </Button>
          </nav>
          {redeemOpen && (
            <form
              className="space-y-4 border-t border-kova-border pt-5"
              onSubmit={(event) => void redeem(event)}
            >
              <h3 className="text-lg font-semibold">
                Confirmar débito de puntos
              </h3>
              <label className="block text-sm">
                Puntos a canjear
                <input
                  className={fieldClass}
                  required
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max={ledger.balance}
                  step="1"
                  value={redeemPoints}
                  onChange={(event) => {
                    setRedeemPoints(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label className="block text-sm">
                Beneficio acordado con el cliente
                <textarea
                  className={fieldClass}
                  required
                  maxLength={300}
                  value={benefit}
                  onChange={(event) => {
                    setBenefit(event.target.value);
                    setConfirmed(false);
                  }}
                />
              </label>
              <label className="flex min-h-11 items-start gap-3 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={confirmed}
                  onChange={(event) => setConfirmed(event.target.checked)}
                />
                <span>
                  Confirmo el débito de puntos. Gestionaré por separado el
                  beneficio; Kova no aplica un descuento ni acredita su entrega.
                </span>
              </label>
              <div className="flex flex-wrap gap-3">
                <Button
                  className={buttonClass}
                  disabled={!canRedeem || panel.busy || !panel.online}
                >
                  Confirmar canje de puntos
                </Button>
                <Button
                  className={buttonClass}
                  variant="ghost"
                  type="button"
                  disabled={panel.busy}
                  onClick={() => {
                    setRedeemOpen(false);
                    setConfirmed(false);
                  }}
                >
                  Cancelar canje
                </Button>
              </div>
            </form>
          )}
        </section>
      )}
    </ViewLayout>
  );
}
