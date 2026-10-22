import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { FileCheck2, Upload } from "lucide-react";
import { Link } from "react-router-dom";
import {
  OperationsError,
  OperationsSession,
  useOnline,
  useOperationsRequest,
  type WorkspaceIdentity,
} from "@/automations/workspace";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ViewEmpty, ViewError } from "@/components/ui/view-states";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import type {
  EntriesPage,
  ReconciliationPreview,
  SettlementEntry,
  SettlementMatch,
} from "./types";

const money = (value: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(value),
  );
const entryLabels = {
  unmatched: "Sin conciliar",
  partially_matched: "Conciliación parcial",
  matched: "Conciliado",
};
const matchLabels = {
  suggested: "Sugerencia",
  confirmed: "Confirmado",
  rejected: "Rechazado",
  reversed: "Revertido",
};
const methodLabel = (method: string) =>
  method === "manual_card" ? "Tarjeta manual" : "Transferencia";

export default function ReconciliationView() {
  useDocumentTitle("Conciliación de depósitos");
  return (
    <OperationsSession>
      {(identity) => <ReconciliationWorkspace identity={identity} />}
    </OperationsSession>
  );
}

function ReconciliationWorkspace({
  identity,
}: {
  identity: WorkspaceIdentity;
}) {
  const request = useOperationsRequest("/api/v1/reconciliation", identity);
  const online = useOnline();
  const [page, setPage] = useState<EntriesPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [csv, setCsv] = useState("");
  const [preview, setPreview] = useState<ReconciliationPreview | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [reverseId, setReverseId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const mounted = useRef(true);
  const locked = useRef(false);
  const generation = useRef(0);
  const commitCommand = useRef<{ body: string; key: string } | null>(null);
  const load = useCallback(async () => {
    const revision = ++generation.current;
    setLoading(true);
    try {
      const result = await request<EntriesPage>(
        `/entries?limit=50&offset=${offset}`,
      );
      if (mounted.current && revision === generation.current) {
        setPage(result);
        setError("");
      }
    } catch (e) {
      if (
        mounted.current &&
        revision === generation.current &&
        !(e instanceof DOMException && e.name === "AbortError")
      )
        setError(
          e instanceof Error ? e.message : "No pudimos cargar los depósitos.",
        );
    } finally {
      if (mounted.current && revision === generation.current) setLoading(false);
    }
  }, [request, offset]);
  useEffect(() => {
    mounted.current = true;
    void load();
    return () => {
      mounted.current = false;
    };
  }, [load]);
  const mutate = async (
    action: () => Promise<unknown>,
    success: string,
    after?: () => void,
  ) => {
    if (locked.current || !online) return;
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      if (!mounted.current) return;
      after?.();
      setNotice(success);
      await load();
    } catch (e) {
      if (!mounted.current) return;
      if (e instanceof OperationsError && e.status === 409) await load();
      if (mounted.current)
        setError(
          e instanceof Error
            ? e.message
            : "No pudimos completar la conciliación.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const inspect = async (event: FormEvent) => {
    event.preventDefault();
    if (!file || locked.current || !online) return;
    if (file.size > 256 * 1024) {
      setError("El CSV debe pesar como máximo 256 KiB.");
      return;
    }
    locked.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    setPreview(null);
    setSelected([]);
    try {
      const content = await file.text();
      if (!mounted.current) return;
      const result = await request<ReconciliationPreview>(
        "/imports/preview",
        "POST",
        { csv_content: content },
        crypto.randomUUID(),
      );
      if (mounted.current) {
        setCsv(content);
        setPreview(result);
      }
    } catch (e) {
      if (mounted.current)
        setError(
          e instanceof Error ? e.message : "No pudimos revisar el archivo.",
        );
    } finally {
      locked.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const commit = () => {
    if (!preview || !selected.length) return;
    const body = {
      csv_content: csv,
      content_sha256: preview.content_sha256,
      parser_version: preview.parser_version,
      selected_rows: [...selected].sort((a, b) => a - b),
    };
    const serialized = JSON.stringify(body);
    if (commitCommand.current?.body !== serialized)
      commitCommand.current = { body: serialized, key: crypto.randomUUID() };
    const key = commitCommand.current.key;
    void mutate(
      () => request("/imports/commit", "POST", body, key),
      "Movimientos importados. Revisa las sugerencias antes de confirmar vínculos.",
      () => {
        setPreview(null);
        setSelected([]);
        setCsv("");
        setFile(null);
        commitCommand.current = null;
      },
    );
  };
  const action = (
    entry: SettlementEntry,
    match: SettlementMatch,
    type: "confirm" | "reject" | "reverse",
  ) =>
    void mutate(
      () =>
        request(
          `/entries/${entry.id}/matches/${match.id}/${type}`,
          "POST",
          {
            expected_version: match.version,
            ...(type === "reverse" ? { reason: reason.trim() } : {}),
          },
          crypto.randomUUID(),
        ),
      type === "confirm"
        ? "Vínculo confirmado. La venta y el efectivo de caja conservan sus importes."
        : type === "reject"
          ? "Sugerencia rechazada."
          : "Vínculo revertido; su historial se conserva.",
      () => {
        setReverseId(null);
        setReason("");
      },
    );
  return (
    <ViewLayout className="space-y-7 [&_.animate-fade-in]:animate-none">
      <ViewHeader
        eyebrow="Control del dinero"
        title="Conciliación de depósitos"
        meta="Compara liquidaciones con pagos registrados y confirma cada vínculo."
      />
      <p className="max-w-3xl text-sm leading-6 text-muted-foreground">
        Este flujo registra conciliación. No procesa tarjetas, mueve dinero ni
        modifica ventas o cortes de caja. El formato de importación es de Kova y
        requiere preparar los datos; no es un conector bancario.
      </p>
      {!online && (
        <p role="status" className="rounded-xl border p-4 text-sm">
          Conéctate para importar y conciliar movimientos.
        </p>
      )}
      {error && (
        <ViewError
          message={error}
          onRetry={() => void load()}
          retryLabel="Cargar versión actual"
        />
      )}
      {notice && (
        <p
          role="status"
          className="rounded-xl border border-kova-growth/30 bg-kova-growth/10 p-4 text-sm text-kova-growth-strong"
        >
          {notice}
        </p>
      )}
      <section
        className="space-y-4 rounded-2xl border bg-card p-5"
        aria-labelledby="reconciliation-import"
      >
        <div className="flex items-center gap-3">
          <Upload className="h-5 w-5 text-kova-blue" aria-hidden="true" />
          <h2 id="reconciliation-import" className="text-lg font-semibold">
            Importar CSV preparado
          </h2>
        </div>
        <details className="rounded-xl bg-muted p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Columnas y requisitos del archivo
          </summary>
          <p className="mt-3 leading-6">
            UTF-8, máximo 500 filas y 256 KiB. Fechas ISO con zona horaria,
            importes con dos decimales, moneda MXN y método bank_transfer o
            manual_card. La referencia debe estar enmascarada, por ejemplo
            ***1234. Excluye números de cuenta completos y datos de tarjeta.
          </p>
          <code
            aria-label="Columnas obligatorias del CSV"
            className="mt-3 block break-all whitespace-normal rounded-lg border bg-background p-3 text-xs"
          >
            settled_at,gross_amount,fee_amount,net_amount,currency,payment_method,reference
          </code>
          <p className="mt-3">
            El importe bruto menos la comisión debe coincidir con el neto. El
            archivo original no se conserva.
          </p>
        </details>
        <form
          onSubmit={(event) => void inspect(event)}
          className="flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="min-w-0 flex-1">
            <Label htmlFor="settlement-csv">Archivo CSV de liquidaciones</Label>
            <Input
              id="settlement-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={busy || !online}
              onChange={(event) => {
                setFile(event.target.files?.[0] ?? null);
                setPreview(null);
                setCsv("");
                setSelected([]);
              }}
            />
          </div>
          <Button
            type="submit"
            variant="outline"
            disabled={busy || !online || !file}
          >
            Revisar archivo
          </Button>
        </form>
        {preview && (
          <div className="space-y-4" aria-label="Vista previa de importación">
            <h3 className="font-semibold">
              Revisa y selecciona los movimientos
            </h3>
            {preview.errors.length > 0 && (
              <div
                role="alert"
                className="rounded-xl border border-destructive/30 p-4 text-sm"
              >
                <p className="font-medium">
                  Hay filas que requieren corrección.
                </p>
                <ul className="mt-2 list-inside list-disc">
                  {preview.errors.map((issue, index) => (
                    <li key={`${issue.row_number}:${index}`}>
                      Fila {issue.row_number}: {issue.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {preview.rows.length > 0 ? (
              <>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    disabled={busy || !online}
                    checked={selected.length === preview.rows.length}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? preview.rows.map((row) => row.row_number)
                          : [],
                      )
                    }
                  />
                  Seleccionar todas las filas válidas ({preview.rows.length})
                </label>
                <div
                  className="overflow-x-auto rounded-xl border"
                  role="region"
                  aria-label="Vista previa de movimientos"
                >
                  <table className="w-full text-left text-sm">
                    <caption className="sr-only">
                      Movimientos válidos del archivo CSV
                    </caption>
                    <thead className="bg-muted">
                      <tr>
                        <th className="p-3" scope="col">
                          Importar
                        </th>
                        <th className="p-3" scope="col">
                          Fecha
                        </th>
                        <th className="p-3" scope="col">
                          Referencia
                        </th>
                        <th className="p-3" scope="col">
                          Bruto
                        </th>
                        <th className="p-3" scope="col">
                          Comisión
                        </th>
                        <th className="p-3" scope="col">
                          Neto
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {preview.rows.map((row) => (
                        <tr key={row.row_number}>
                          <td className="p-3">
                            <input
                              type="checkbox"
                              aria-label={`Importar fila ${row.row_number}`}
                              disabled={busy || !online}
                              checked={selected.includes(row.row_number)}
                              onChange={(event) =>
                                setSelected((values) =>
                                  event.target.checked
                                    ? [...values, row.row_number]
                                    : values.filter(
                                        (value) => value !== row.row_number,
                                      ),
                                )
                              }
                            />
                          </td>
                          <td className="whitespace-nowrap p-3">
                            {new Date(row.settled_at).toLocaleString("es-MX")}
                          </td>
                          <td className="p-3">
                            {row.external_reference_masked}
                          </td>
                          <td className="whitespace-nowrap p-3">
                            {money(row.gross_amount)}
                          </td>
                          <td className="whitespace-nowrap p-3">
                            {money(row.fee_amount)}
                          </td>
                          <td className="whitespace-nowrap p-3">
                            {money(row.net_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <Button
                  disabled={busy || !online || selected.length === 0}
                  onClick={commit}
                  className="h-auto min-h-11 max-w-full whitespace-normal"
                >
                  Importar {selected.length} movimientos seleccionados
                </Button>
              </>
            ) : (
              <p className="text-sm">
                No hay filas válidas para importar. Corrige el archivo y vuelve
                a revisarlo.
              </p>
            )}
          </div>
        )}
      </section>
      <section className="space-y-4" aria-labelledby="reconciliation-entries">
        <h2 id="reconciliation-entries" className="text-lg font-semibold">
          Depósitos y liquidaciones
        </h2>
        {loading && !page && <p role="status">Cargando movimientos…</p>}
        {page?.entries.length === 0 && (
          <ViewEmpty
            icon={<FileCheck2 className="h-6 w-6" />}
            title="Empieza con una liquidación real"
            body="Prepara un CSV en el formato de Kova. Podrás revisar los datos antes de importar y confirmar sus vínculos con pagos."
          />
        )}
        {page?.entries.map((entry) => (
          <article
            key={entry.id}
            className="space-y-4 rounded-2xl border bg-card p-5"
          >
            <div className="flex flex-col justify-between gap-4 sm:flex-row">
              <div>
                <h3 className="font-semibold">
                  {entry.external_reference_masked}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  {methodLabel(entry.payment_method)} ·{" "}
                  {new Date(entry.settled_at).toLocaleString("es-MX")}
                </p>
                <span className="mt-2 inline-block rounded-full bg-muted px-2 py-1 text-xs">
                  {entryLabels[entry.status]}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Importe bruto
                  </dt>
                  <dd className="font-medium">{money(entry.gross_amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">Comisión</dt>
                  <dd>{money(entry.fee_amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Neto recibido
                  </dt>
                  <dd className="font-medium">{money(entry.net_amount)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    Pendiente de vincular
                  </dt>
                  <dd>{money(entry.remaining_amount)}</dd>
                </div>
              </dl>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !online || entry.status === "matched"}
              onClick={() =>
                void mutate(
                  () =>
                    request(
                      `/entries/${entry.id}/suggest`,
                      "POST",
                      {},
                      crypto.randomUUID(),
                    ),
                  "Sugerencias revisadas. Confirma sólo los vínculos que reconozcas.",
                )
              }
            >
              Buscar pagos candidatos
            </Button>
            {entry.matches.length > 0 && (
              <ul className="divide-y rounded-xl border px-4">
                {entry.matches.map((match) => (
                  <li key={match.id} className="space-y-3 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <p className="text-sm font-medium">
                        {money(match.matched_amount)} ·{" "}
                        {matchLabels[match.status]}
                      </p>
                      <Link
                        to={`/orders/${match.order_id}`}
                        className="text-sm text-kova-blue underline"
                      >
                        Revisar venta
                      </Link>
                    </div>
                    {match.reasons.length > 0 && (
                      <ul className="space-y-1 text-xs text-muted-foreground">
                        {match.reasons.map((item, index) => (
                          <li key={index}>{item}</li>
                        ))}
                      </ul>
                    )}
                    {match.status === "suggested" && (
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          disabled={busy || !online}
                          onClick={() => action(entry, match, "confirm")}
                        >
                          Confirmar vínculo
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !online}
                          onClick={() => action(entry, match, "reject")}
                        >
                          Rechazar sugerencia
                        </Button>
                      </div>
                    )}
                    {match.status === "confirmed" &&
                      (reverseId === match.id ? (
                        <form
                          className="space-y-3"
                          onSubmit={(event) => {
                            event.preventDefault();
                            action(entry, match, "reverse");
                          }}
                        >
                          <Label htmlFor={`reverse-${match.id}`}>
                            Motivo de la reversa
                          </Label>
                          <Input
                            id={`reverse-${match.id}`}
                            value={reason}
                            onChange={(event) => setReason(event.target.value)}
                            required
                            minLength={3}
                            maxLength={200}
                          />
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="submit"
                              size="sm"
                              variant="outline"
                              disabled={
                                busy || !online || reason.trim().length < 3
                              }
                            >
                              Confirmar reversa
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => setReverseId(null)}
                            >
                              Cancelar
                            </Button>
                          </div>
                        </form>
                      ) : (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy || !online}
                          onClick={() => {
                            setReverseId(match.id);
                            setReason("");
                          }}
                        >
                          Revertir vínculo
                        </Button>
                      ))}
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </section>
      {page && (offset > 0 || page.has_more) && (
        <nav
          aria-label="Páginas de liquidaciones"
          className="flex flex-wrap items-center gap-3"
        >
          <Button
            variant="outline"
            disabled={busy || loading || !online || offset === 0}
            onClick={() => setOffset((value) => Math.max(0, value - 50))}
          >
            Anterior
          </Button>
          <span className="text-sm text-muted-foreground">
            Página {Math.floor(offset / 50) + 1}
          </span>
          <Button
            variant="outline"
            disabled={busy || loading || !online || !page.has_more}
            onClick={() => setOffset((value) => value + 50)}
          >
            Más movimientos
          </Button>
        </nav>
      )}
    </ViewLayout>
  );
}
