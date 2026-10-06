import { type FormEvent, useEffect, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { csrfHeaders } from "@/lib/csrf";
import { listBranches, type Branch } from "./api";

type Stock = {
  product_id: string;
  product_name: string;
  available_quantity: number;
};
type Transfer = {
  id: string;
  source_branch_id: string;
  destination_branch_id: string;
  product_id: string;
  product_name: string;
  quantity: number;
  reason: string;
  created_at: string;
};
async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      detail?: unknown;
    };
    throw new Error(
      typeof body.detail === "string"
        ? body.detail
        : "No pudimos completar el traspaso. Revisa los datos e intenta de nuevo.",
    );
  }
  return response.json() as Promise<T>;
}
export function InventoryTransfers() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [stock, setStock] = useState<Stock[]>([]);
  const [history, setHistory] = useState<Transfer[]>([]);
  const [source, setSource] = useState("");
  const [destination, setDestination] = useState("");
  const [product, setProduct] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [loadingStock, setLoadingStock] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => {
    let alive = true;
    Promise.all([
      listBranches(),
      request<Transfer[]>("/api/v1/branches/transfers"),
    ])
      .then(([locations, transfers]) => {
        if (alive) {
          setBranches(locations);
          setHistory(transfers);
        }
      })
      .catch((err: unknown) => {
        if (alive)
          setError(
            err instanceof Error
              ? err.message
              : "No pudimos cargar los traspasos.",
          );
      });
    return () => {
      alive = false;
    };
  }, [refresh]);
  useEffect(() => {
    let alive = true;
    setStock([]);
    setProduct("");
    if (!source) return;
    setLoadingStock(true);
    request<Stock[]>("/api/v1/inventory/stock", {
      headers: { "X-Kova-Branch": source },
    })
      .then((rows) => {
        if (alive) setStock(rows);
      })
      .catch((err: unknown) => {
        if (alive)
          setError(
            err instanceof Error
              ? err.message
              : "No pudimos cargar las existencias.",
          );
      })
      .finally(() => {
        if (alive) setLoadingStock(false);
      });
    return () => {
      alive = false;
    };
  }, [source, refresh]);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    if (!navigator.onLine) {
      setError("Conéctate a internet para registrar un traspaso.");
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    const payload = JSON.stringify({
      source_branch_id: source,
      destination_branch_id: destination,
      product_id: product,
      quantity: Number(quantity),
      reason: reason.trim(),
    });
    if (attempt.current?.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    try {
      await request<Transfer>("/api/v1/branches/transfers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...csrfHeaders("POST"),
          "Idempotency-Key": attempt.current.key,
        },
        body: payload,
      });
      attempt.current = null;
      setReason("");
      setQuantity("1");
      setSuccess(
        "Traspaso registrado. Las existencias de ambas sucursales se actualizaron.",
      );
      setRefresh((value) => value + 1);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "No pudimos registrar el traspaso.",
      );
    } finally {
      setBusy(false);
    }
  };
  const selected = stock.find((row) => row.product_id === product);
  const branchName = (id: string) =>
    branches.find((row) => row.id === id)?.name ?? "Sucursal";
  return (
    <Card>
      <CardHeader>
        <CardTitle>Traspasos de inventario</CardTitle>
        <p className="text-sm text-muted-foreground">
          Mueve mercancía entre sucursales. Se registra al instante y requiere
          conexión a internet. Las unidades reservadas para pedidos permanecen
          en origen.
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
        {success && <p role="status">{success}</p>}
        {branches.length < 2 ? (
          <p>Necesitas acceso a dos sucursales para registrar traspasos.</p>
        ) : (
          <form
            onSubmit={(event) => void submit(event)}
            className="grid max-w-xl gap-4"
          >
            <div>
              <Label htmlFor="transfer-source">Sucursal de origen</Label>
              <Select
                id="transfer-source"
                required
                disabled={busy}
                value={source}
                onChange={(event) => setSource(event.target.value)}
              >
                <option value="">Selecciona origen</option>
                {branches.map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="transfer-destination">Sucursal de destino</Label>
              <Select
                id="transfer-destination"
                required
                disabled={busy}
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              >
                <option value="">Selecciona destino</option>
                {branches
                  .filter((row) => row.id !== source)
                  .map((row) => (
                    <option key={row.id} value={row.id}>
                      {row.name}
                    </option>
                  ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="transfer-product">Producto</Label>
              <Select
                id="transfer-product"
                required
                disabled={busy || loadingStock || !source}
                value={product}
                onChange={(event) => setProduct(event.target.value)}
              >
                <option value="">
                  {loadingStock
                    ? "Cargando existencias…"
                    : "Selecciona producto"}
                </option>
                {stock.map((row) => (
                  <option key={row.product_id} value={row.product_id}>
                    {row.product_name} · {row.available_quantity} disponibles
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="transfer-quantity">Unidades a mover</Label>
              <Input
                id="transfer-quantity"
                type="number"
                min={1}
                max={selected?.available_quantity ?? 2147483647}
                step={1}
                required
                disabled={busy}
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="transfer-reason">Motivo</Label>
              <Input
                id="transfer-reason"
                maxLength={200}
                required
                disabled={busy}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                placeholder="Ej. Reposición de mercancía"
              />
            </div>
            <Button
              disabled={
                busy ||
                !product ||
                !source ||
                !destination ||
                source === destination ||
                !reason.trim() ||
                Number(quantity) < 1 ||
                Number(quantity) > (selected?.available_quantity ?? 0)
              }
            >
              {busy ? "Registrando…" : "Registrar traspaso"}
            </Button>
          </form>
        )}
        <div>
          <h3 className="font-medium">Últimos traspasos</h3>
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Aún no hay traspasos registrados.
            </p>
          ) : (
            <ul className="divide-y">
              {history.map((row) => (
                <li key={row.id} className="py-3">
                  <p>
                    {branchName(row.source_branch_id)} →{" "}
                    {branchName(row.destination_branch_id)} · {row.product_name} · {row.quantity}{" "}
                    unidades
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {row.reason} ·{" "}
                    {new Date(row.created_at).toLocaleString("es-MX")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
