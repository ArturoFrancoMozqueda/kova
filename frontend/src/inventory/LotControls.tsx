import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { formatLotDate, allocationValid, classifyLot, listLots, proposeLots, saveLot, suggestDates, type Lot, type LotAllocation, type LotWrite } from "./lots";

export function LotPicker({ rows, value, quantity, onChange, incoming = false, physical = false, disabled = false }: {
  rows: Lot[]; value: LotAllocation[]; quantity: number; onChange: (parts: LotAllocation[]) => void;
  incoming?: boolean; physical?: boolean; disabled?: boolean;
}) {
  const id = useId();
  const change = (lotId: string, amount: number) => onChange([...value.filter(p => p.lot_id !== lotId), ...(amount > 0 ? [{ lot_id: lotId, quantity: amount }] : [])]);
  return <fieldset className="space-y-3 rounded-lg border p-3" disabled={disabled}>
    <legend className="px-1 text-sm font-semibold">Lotes a {incoming ? "recibir" : physical ? "ajustar" : "entregar"}</legend>
    {!rows.length && <p className="text-sm">No hay lotes registrados. Crea uno en inventario para continuar.</p>}
    {rows.map(lot => <div key={lot.id} className="grid grid-cols-[1fr_6rem] items-center gap-3">
      <Label htmlFor={`${id}-${lot.id}`}><span className="block">{lot.code}</span>
        <span className="text-xs font-normal text-muted-foreground">{physical ? lot.stock_on_hand : lot.available_quantity} unidades · {lot.expires_on ? `Caducidad: ${formatLotDate(lot.expires_on)}` : lot.rotation_on ? `${lot.rotation_label === "fecha_objetivo" ? "Fecha objetivo" : "Consumo preferente"}: ${formatLotDate(lot.rotation_on)}` : lot.manufactured_on ? `Elaboración: ${formatLotDate(lot.manufactured_on)}` : "Fecha desconocida"}</span>
        {lot.date_status === "vencido" && <span className="block text-xs text-warning-strong">Fecha vencida. La venta está permitida.</span>}
        {lot.stock_conflict && <span className="block text-xs text-destructive">Hay un faltante en unidades reservadas.</span>}
      </Label>
      <Input id={`${id}-${lot.id}`} type="number" inputMode="numeric" min={0} step={1} max={incoming ? 2147483647 : physical ? lot.stock_on_hand : lot.available_quantity}
        value={value.find(p => p.lot_id === lot.id)?.quantity ?? 0} onChange={e => change(lot.id, Number(e.target.value))} />
    </div>)}
    <p className="text-xs" role="status">{value.reduce((sum, part) => sum + part.quantity, 0)} de {quantity} unidades asignadas{allocationValid(value, quantity) ? "" : ". Completa la cantidad antes de continuar."}</p>
    {!incoming && !physical && <Button type="button" variant="outline" size="sm" onClick={() => onChange(proposeLots(rows, quantity))}>Sugerir por fecha</Button>}
  </fieldset>;
}

export function LotForm({ productId, initial, onSaved, onCancel }: { productId: string; initial?: Lot; onSaved: () => void; onCancel: () => void }) {
  const id = useId();
  const [body, setBody] = useState<LotWrite>({ code: initial?.code ?? "", manufactured_on: initial?.manufactured_on ?? null, rotation_on: initial?.rotation_on ?? null, expires_on: initial?.expires_on ?? null });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  const suggestionRequest = useRef(0);
  const elaboration = async (value: string) => {
    const current = ++suggestionRequest.current;
    setBody(previous => ({ ...previous, manufactured_on: value || null }));
    if (!value || initial) return;
    try {
      const dates = await suggestDates(productId, value);
      if (current === suggestionRequest.current) setBody(previous => ({ ...previous, rotation_on: dates.rotation_on, expires_on: dates.expires_on }));
    } catch { if (current === suggestionRequest.current) setError("No pudimos calcular sugerencias. Puedes capturar las fechas manualmente."); }
  };
  const submit = async () => { if (pending) return;
    if (body.manufactured_on && [body.rotation_on, body.expires_on].some(limit => limit && limit < body.manufactured_on!)) { setError("Las fechas límite no pueden ser anteriores a la elaboración."); return; }
    setPending(true); setError("");
    const payload = JSON.stringify(body);
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try { await saveLot(productId, body, attempt.current.key, initial?.id); onSaved(); }
    catch (err) { setError(err instanceof Error ? err.message : "No pudimos guardar el lote."); }
    finally { setPending(false); }
  };
  return <div role="group" className="space-y-3 rounded-lg border p-3">
    <p className="text-sm font-semibold">{initial ? "Corregir lote" : "Nuevo lote"}</p>
    <Label htmlFor={`${id}-code`}>Identificador del lote</Label><Input id={`${id}-code`} value={body.code} required maxLength={100} disabled={pending} onChange={e => setBody({ ...body, code: e.target.value })} />
    {(["manufactured_on", "rotation_on", "expires_on"] as const).map((field, index) => <div key={field}>
      <Label htmlFor={`${id}-${field}`}>{["Elaboración", "Consumo preferente o fecha objetivo", "Caducidad"][index]}</Label>
      <Input id={`${id}-${field}`} type="date" value={body[field] ?? ""} disabled={pending}
        onChange={e => field === "manufactured_on" ? void elaboration(e.target.value) : setBody({ ...body, [field]: e.target.value || null })} />
    </div>)}
    <p className="text-xs text-muted-foreground">Revisa las sugerencias antes de guardar. Crear un lote no agrega existencias; registra después las unidades recibidas.</p>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-2"><Button type="button" onClick={() => void submit()} disabled={pending || !body.code.trim()}>Confirmar fechas y guardar</Button><Button type="button" variant="outline" onClick={onCancel} disabled={pending}>Cancelar</Button></div>
  </div>;
}

export function LotAllocationEditor({ productId, quantity, value, onChange, branchId, incoming, physical, canCreate = false, reservedParts = [] }: {
  productId: string; quantity: number; value: LotAllocation[]; onChange: (parts: LotAllocation[]) => void;
  branchId?: string; incoming?: boolean; physical?: boolean; canCreate?: boolean; reservedParts?: LotAllocation[];
}) {
  const [rows, setRows] = useState<Lot[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true; setLoading(true); setRows([]); setError("");
    void listLots(productId, branchId).then(result => { if (alive) setRows(result); }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "No pudimos cargar los lotes."); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [productId, branchId, refresh]);
  return <div className="space-y-3">
    {loading ? <p role="status">Cargando lotes…</p> : error ? <div><p role="alert">{error}</p><Button type="button" onClick={() => setRefresh(refresh + 1)}>Reintentar</Button></div> : <LotPicker rows={reservedParts.length ? rows.map(lot => ({ ...lot, available_quantity: Math.min(lot.stock_on_hand, lot.available_quantity + (reservedParts.find(p => p.lot_id === lot.id)?.quantity ?? 0)) })) : rows} quantity={quantity} value={value} onChange={onChange} incoming={incoming} physical={physical} />}
    {canCreate && (creating ? <LotForm productId={productId} onCancel={() => setCreating(false)} onSaved={() => { setCreating(false); setRefresh(refresh + 1); }} /> : <Button type="button" variant="outline" onClick={() => setCreating(true)}>Crear lote</Button>)}
  </div>;
}

export function LotsPanel({ productId, canAdjust }: { productId: string; canAdjust: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [rows, setRows] = useState<Lot[]>([]);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Lot | "new" | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [source, setSource] = useState(""); const [destination, setDestination] = useState("");
  const [quantity, setQuantity] = useState("1"); const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const attempt = useRef<{ payload: string; key: string } | null>(null);
  useEffect(() => { if (!expanded) return; let alive = true; void listLots(productId).then(result => { if (alive) { setRows(result); setError(""); } }).catch(err => { if (alive) setError(err instanceof Error ? err.message : "No pudimos cargar los lotes."); }); return () => { alive = false; }; }, [productId, refresh, expanded]);
  const classify = async (event: FormEvent) => {
    event.preventDefault(); if (pending) return; setPending(true); setError("");
    const payload = JSON.stringify({ source, destination, quantity, reason });
    if (attempt.current?.payload !== payload) attempt.current = { payload, key: crypto.randomUUID() };
    try { await classifyLot(productId, source, destination, Number(quantity), reason, attempt.current.key); attempt.current = null; setRefresh(refresh + 1); }
    catch (err) { setError(err instanceof Error ? err.message : "No pudimos clasificar las unidades."); }
    finally { setPending(false); }
  };
  const id = useId();
  return <details className="mt-3 rounded-lg border p-3" onToggle={event => setExpanded(event.currentTarget.open)}><summary className="min-h-11 cursor-pointer font-medium">Lotes y fechas</summary>
    {error && <p role="alert">{error}</p>}
    <div className="space-y-3">{rows.map(lot => <div className="rounded-lg border p-3" key={lot.id}><p className="font-semibold">{lot.code}</p>
      <p className="text-sm">{lot.stock_on_hand} físicas · {lot.reserved_quantity} reservadas · {lot.available_quantity} disponibles</p>
      <p className="text-xs">Elaboración: {formatLotDate(lot.manufactured_on, "Desconocida")} · {lot.rotation_label === "fecha_objetivo" ? "Fecha objetivo" : "Consumo preferente"}: {formatLotDate(lot.rotation_on)} · Caducidad: {formatLotDate(lot.expires_on)}</p>
      {(lot.date_status === "vencido" || lot.date_status === "proximo") && <p className="text-sm text-warning-strong">{lot.date_status === "vencido" ? "Fecha vencida" : "Conviene mover estas unidades en los próximos siete días"}. La venta está permitida.</p>}
      {lot.stock_conflict && <p role="alert" className="text-sm text-destructive">Faltan unidades reservadas. Revisa el pedido antes de cobrar.</p>}
      {canAdjust && !lot.is_unknown && <Button type="button" variant="outline" onClick={() => setEditing(lot)}>Corregir fechas</Button>}
    </div>)}</div>
    {canAdjust && <div className="mt-3 space-y-3">{editing ? <LotForm productId={productId} initial={editing === "new" ? undefined : editing} onCancel={() => setEditing(null)} onSaved={() => { setEditing(null); setRefresh(refresh + 1); }} /> : <Button type="button" variant="outline" onClick={() => setEditing("new")}>Nuevo lote</Button>}
      <form onSubmit={event => void classify(event)} className="space-y-2"><p className="text-sm font-medium">Clasificar unidades libres sin cambiar el total</p>
        <Label htmlFor={`${id}-source`}>Lote de origen</Label><Select id={`${id}-source`} value={source} onChange={e => setSource(e.target.value)} required><option value="">Selecciona</option>{rows.map(lot => <option key={lot.id} value={lot.id}>{lot.code}</option>)}</Select>
        <Label htmlFor={`${id}-dest`}>Lote identificado</Label><Select id={`${id}-dest`} value={destination} onChange={e => setDestination(e.target.value)} required><option value="">Selecciona</option>{rows.filter(lot => lot.id !== source).map(lot => <option key={lot.id} value={lot.id}>{lot.code}</option>)}</Select>
        <Label htmlFor={`${id}-quantity`}>Unidades a clasificar</Label><Input id={`${id}-quantity`} type="number" min={1} step={1} value={quantity} onChange={e => setQuantity(e.target.value)} required />
        <Label htmlFor={`${id}-reason`}>Motivo</Label><Input id={`${id}-reason`} value={reason} onChange={e => setReason(e.target.value)} maxLength={255} required />
        <Button type="submit" disabled={pending || !source || !destination || !reason.trim()}>Confirmar clasificación</Button>
      </form>
    </div>}
  </details>;
}
