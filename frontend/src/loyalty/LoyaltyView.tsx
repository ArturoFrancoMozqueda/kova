import { useEffect, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
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
import { RewardSettings } from "./rewards/RewardSettings";
import { EnrollmentSettings } from "@/loyaltyCard/EnrollmentSettings";

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
  reward_return: "Puntos restituidos por devolución",
};
const fieldClass =
  "mt-1 min-h-11 w-full rounded-lg border border-input bg-white p-3";
const buttonClass = "h-auto min-h-11 whitespace-normal";
const money = (value: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(value),
  );
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
      {(identity) => <LoyaltyWorkspace identity={identity} />}
    </OperationsSession>
  );
}
function LoyaltyWorkspace({ identity }: { identity: WorkspaceIdentity }) {
  const [offset, setOffset] = useState(0);
  const panel = useOperationsPanel<LoyaltyOverview>(
    "/api/v1/loyalty",
    identity,
    `?limit=50&offset=${offset}`,
  );
  const { request } = panel;
  const customersRequest = useOperationsRequest("/api/v1/customers", identity);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [spendAmount, setSpendAmount] = useState("");
  const [pointsPerStep, setPointsPerStep] = useState("");
  const [policyVersion, setPolicyVersion] = useState(0);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState("");
  const [customerError, setCustomerError] = useState("");
  const [customerLoading, setCustomerLoading] = useState(true);
  const [customerAttempt, setCustomerAttempt] = useState(0);
  const [customerId, setCustomerId] = useState("");
  const [ledger, setLedger] = useState<LoyaltyLedger | null>(null);
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
  const editPolicy = () => {
    if (!panel.data) return;
    const row = panel.data.policy;
    setPolicyVersion(row.version);
    setEnabled(row.enabled);
    setSpendAmount(row.spend_amount ?? "");
    setPointsPerStep(
      row.points_per_step == null ? "" : String(row.points_per_step),
    );
    setPolicyOpen(true);
  };
  const savePolicy = async (event: FormEvent) => {
    event.preventDefault();
    if (
      await panel.mutate(
        "/policy",
        "PUT",
        {
          expected_version: policyVersion,
          enabled,
          spend_amount: spendAmount,
          points_per_step: Number(pointsPerStep),
        },
        "Regla de lealtad actualizada. Los movimientos anteriores conservan su regla original.",
      )
    )
      setPolicyOpen(false);
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
      <RewardSettings key={`${identity.tenantId}:${identity.userId}:${identity.branchId}`} identity={identity} />
      <EnrollmentSettings key={`enrollment:${identity.tenantId}:${identity.userId}:${identity.branchId}`} identity={identity} />
      {panel.loading && <p role="status">Consultando lealtad…</p>}
      {panel.data && (
        <section className="space-y-4 rounded-2xl border border-kova-border bg-white p-6">
          <div className="flex flex-wrap justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold">Regla de acumulación</h2>
              <p className="mt-2 text-sm">
                {panel.data.policy.enabled ? "Activa" : "Desactivada"}
              </p>
            </div>
            <Button
              className={buttonClass}
              variant="outline"
              disabled={panel.busy || !panel.online}
              onClick={editPolicy}
            >
              Revisar regla de puntos
            </Button>
          </div>
          <p className="text-sm">
            {panel.data.policy.spend_amount &&
            panel.data.policy.points_per_step != null
              ? `${points(panel.data.policy.points_per_step)} puntos por cada ${money(panel.data.policy.spend_amount)} de compra elegible.`
              : "Todavía no has definido una regla de acumulación."}
          </p>
          <p className="text-sm text-kova-muted">
            Sólo acumulan las ventas elegibles con cliente registrado después de
            activar la regla. Las devoluciones y anulaciones pueden reducir los
            puntos, incluso con la regla desactivada.
          </p>
          <Button
            className={buttonClass}
            variant="outline"
            disabled={panel.busy || !panel.online}
            onClick={() =>
              void panel
                .mutate(
                  "/process",
                  "POST",
                  {},
                  "Movimientos revisados con las ventas, devoluciones y anulaciones disponibles.",
                )
                .then((ok) => {
                  if (ok) setLedgerRevision((value) => value + 1);
                })
            }
          >
            Actualizar movimientos de puntos
          </Button>
        </section>
      )}
      {policyOpen && (
        <form
          className="space-y-4 rounded-2xl border border-kova-border bg-white p-6"
          onSubmit={(event) => void savePolicy(event)}
        >
          <h2 className="text-xl font-semibold">Confirmar regla de puntos</h2>
          <label className="flex min-h-11 items-center gap-3 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Acumular puntos en nuevas ventas elegibles
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Compra necesaria por bloque (MXN)
              <input
                className={fieldClass}
                required
                type="number"
                inputMode="decimal"
                min="0.01"
                max="1000000"
                step="0.01"
                value={spendAmount}
                onChange={(event) => setSpendAmount(event.target.value)}
              />
            </label>
            <label className="text-sm">
              Puntos por bloque de compra
              <input
                className={fieldClass}
                required
                type="number"
                inputMode="numeric"
                min="1"
                max="10000"
                step="1"
                value={pointsPerStep}
                onChange={(event) => setPointsPerStep(event.target.value)}
              />
            </label>
          </div>
          <p className="text-sm text-kova-muted">
            Define tu regla antes de activarla. Cambiarla no recalcula la
            acumulación de ventas anteriores.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button
              className={buttonClass}
              disabled={
                panel.busy || !panel.online || !spendAmount || !pointsPerStep
              }
            >
              Confirmar regla de puntos
            </Button>
            <Button
              className={buttonClass}
              variant="ghost"
              type="button"
              disabled={panel.busy}
              onClick={() => setPolicyOpen(false)}
            >
              Cancelar edición
            </Button>
          </div>
        </form>
      )}
      <section className="space-y-4" aria-label="Puntos por cliente">
        <h2 className="text-xl font-semibold">Puntos por cliente</h2>
        {panel.data?.accounts.length === 0 && (
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
              <span className="block break-words font-medium">
                {row.customer_name}
              </span>
              <span className="block text-2xl font-semibold">
                {points(row.balance)} puntos
              </span>
              <span className="block text-xs text-kova-muted">
                Consultar movimientos
              </span>
            </button>
          ))}
        </div>
        <nav
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
        </nav>
      </section>
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
          <h2 className="break-words text-xl font-semibold">
            {ledger.customer_name}
          </h2>
          <output
            aria-label="Saldo de puntos"
            className="block text-3xl font-semibold"
          >
            {points(ledger.balance)} puntos
          </output>
          <DigitalCardShare key={ledger.customer_id} identity={identity} customerId={ledger.customer_id} online={panel.online} disabled={panel.busy} />
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
                  <p className="font-medium">{kinds[entry.kind]}</p>
                  <p className="font-semibold">
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
