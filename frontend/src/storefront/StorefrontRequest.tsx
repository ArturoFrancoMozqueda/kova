import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, CheckCircle2, MessageCircle, ShoppingBag } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  MAX_REQUEST_MESSAGE, menuMoney, menuRequestMessage, menuSubtotal, priceInCents,
  type MenuLine, type OrderOrigin,
} from "./menu";
import { MenuQuantity } from "./MenuQuantity";

type Receipt = { receipt_id: string; status: "received" };

export function StorefrontRequest({ token, lines, onQuantityChange, busy, setBusy, received, onReceived, mode, setMode, onBrowse }: {
  token: string;
  lines: MenuLine[];
  onQuantityChange: (id: string, quantity: number) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  received: boolean;
  onReceived: () => void;
  mode: "order" | "question";
  setMode: (value: "order" | "question") => void;
  onBrowse: () => void;
}) {
  const [origin, setOrigin] = useState<OrderOrigin>("remote");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const controller = useRef(new AbortController());
  const lock = useRef(false);
  const feedback = useRef<HTMLDivElement>(null);
  const isOrder = mode === "order";
  const message = isOrder ? menuRequestMessage(lines, origin, note) : note.trim();
  const tooLong = message.length > MAX_REQUEST_MESSAGE;
  const valid = Boolean(name.trim() && contact.trim() && !tooLong &&
    (isOrder ? lines.length > 0 : message));

  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    const syncOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", syncOnline);
    window.addEventListener("offline", syncOnline);
    return () => {
      current.abort();
      window.removeEventListener("online", syncOnline);
      window.removeEventListener("offline", syncOnline);
    };
  }, []);
  useEffect(() => {
    if (received || error) feedback.current?.focus();
  }, [received, error]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current || received || !valid || !online) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const fields = {
      name: name.trim(), contact: contact.trim(), message,
      product_ids: lines.map(({ product }) => product.id),
    };
    const fingerprint = JSON.stringify(fields);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const response = await fetch(`/api/v1/public/catalog/${encodeURIComponent(token)}/requests`, {
        method: "POST", credentials: "omit", cache: "no-store",
        signal: controller.current.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...fields, submission_id: command.current.id }),
      });
      if (!response.ok) throw new Error(response.status === 429
        ? "Recibimos varias solicitudes. Espera un momento antes de volver a intentar."
        : response.status === 404
          ? "Este menú ya no está disponible para solicitudes."
          : "No pudimos registrar tu solicitud. Revisa los datos y vuelve a intentar.");
      const result = await response.json() as Receipt;
      if (result.status !== "received" || typeof result.receipt_id !== "string" || !result.receipt_id)
        throw new Error("No pudimos confirmar la recepción. Vuelve a intentar con los mismos datos.");
      if (!controller.current.signal.aborted) { setReceipt(result); onReceived(); }
    } catch (e) {
      if (!controller.current.signal.aborted) setError(e instanceof Error
        ? e.message : "No pudimos registrar tu solicitud.");
    } finally {
      lock.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  };
  const field = "mt-2 min-h-11 w-full rounded-xl border border-kova-border bg-white px-3 py-3 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue";

  return <section id="mi-pedido" tabIndex={-1} aria-label="Tu pedido"
    className="scroll-mt-6 overflow-hidden rounded-3xl border border-kova-border bg-white shadow-sm">
    <div className="border-b border-kova-border bg-kova-mist/50 p-4 lg:p-6">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-kova-blue"><ShoppingBag className="h-5 w-5" aria-hidden="true" /></span>
        <div><h2 className="text-xl font-semibold tracking-tight">{isOrder ? "Tu pedido" : "Tu consulta"}</h2>
          <p className="mt-0.5 text-xs text-kova-muted">Elige, revisa y envía al negocio.</p></div>
      </div>
    </div>
    <div className="p-4 lg:p-6">
      {lines.length === 0 ? isOrder && <div className="rounded-2xl border border-dashed border-kova-border px-4 py-6 text-center">
        <p className="text-sm font-medium">¿Qué se te antoja pedir?</p>
        <p className="mt-2 text-sm text-kova-muted">Agrega productos del menú para armar tu pedido.</p>
        <a href="#menu" onClick={onBrowse} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-kova-blue underline underline-offset-4">Explorar el menú</a>
      </div> : <ul aria-label="Productos de tu pedido" className="divide-y divide-kova-border">
        {lines.map(({ product, quantity }) => <li key={product.id} className="py-4 first:pt-0">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 break-words text-sm font-medium">{product.name}</p>
            <p className="shrink-0 text-sm font-semibold tabular-nums">{menuMoney(priceInCents(product.price_amount) * quantity)}</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <MenuQuantity name={product.name} quantity={quantity} disabled={busy || received}
              onChange={value => onQuantityChange(product.id, value)} />
            <Button type="button" variant="ghost" className="px-2 text-xs text-kova-muted underline"
              aria-label={`Quitar ${product.name} del pedido`} disabled={busy || received}
              onClick={() => onQuantityChange(product.id, 0)}>Quitar</Button>
          </div>
        </li>)}
      </ul>}
      {lines.length > 0 && <div className="mt-4 border-t border-kova-border pt-4">
        <div className="flex flex-wrap justify-between gap-2 font-semibold"><span>Subtotal estimado</span>
          <span className="tabular-nums">{menuMoney(menuSubtotal(lines))} <span className="text-xs font-normal text-kova-muted">MXN</span></span></div>
        <p className="mt-2 text-xs leading-relaxed text-kova-muted">El negocio confirma existencias, total y forma de entrega antes de aceptar tu pedido.</p>
      </div>}

      {received ? <div ref={feedback} tabIndex={-1} className="mt-6 rounded-2xl border border-kova-growth/30 bg-kova-growth/10 p-5 outline-none">
        <CheckCircle2 className="mb-3 h-7 w-7 text-kova-growth-strong" aria-hidden="true" />
        <h3 role="status" className="font-semibold">{isOrder ? "Solicitud de pedido recibida" : "Solicitud recibida"}</h3>
        <p className="mt-2 text-sm leading-relaxed">{isOrder
          ? "El negocio recibió tu selección en Kova. Falta que la revise y acepte; te contactará con los datos que dejaste para continuar."
          : "El negocio recibió tu consulta en Kova y podrá responder al contacto que indicaste."}</p>
        <p className="mt-3 text-xs text-kova-muted">No se ha reservado inventario ni realizado un cobro.</p>
        {receipt && <p className="mt-3 break-all text-xs text-kova-muted">Referencia de solicitud: {receipt.receipt_id}</p>}
      </div> : <form className="mt-5 space-y-4 lg:mt-6 lg:space-y-5" onSubmit={event => void submit(event)}>
        <fieldset disabled={busy} className="min-w-0 space-y-4 lg:space-y-5">
          <legend className="sr-only">Datos de tu solicitud</legend>
          <div className="grid grid-cols-2 gap-2" role="group" aria-label="Tipo de solicitud">
            <Button type="button" variant={isOrder ? "default" : "outline"} aria-label="Pedir del menú" aria-pressed={isOrder} onClick={() => setMode("order")}><ShoppingBag aria-hidden="true" />Pedido</Button>
            <Button type="button" variant={!isOrder ? "default" : "outline"} aria-label="Solo consultar" aria-pressed={!isOrder} onClick={() => setMode("question")}><MessageCircle aria-hidden="true" />Consulta</Button>
          </div>
          {isOrder && <fieldset className="min-w-0">
            <legend className="text-sm font-medium">¿Desde dónde pides?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([['remote', 'A distancia'], ['onsite', 'En el negocio']] as const).map(([value, label]) => <label key={value}
                className={`flex min-h-12 cursor-pointer items-center gap-2 rounded-xl border p-3 text-sm ${origin === value ? "border-kova-blue bg-kova-mist" : "border-kova-border"}`}>
                <input type="radio" name="order-origin" value={value} checked={origin === value} onChange={() => setOrigin(value)} />{label}
              </label>)}
            </div>
          </fieldset>}
          <label className="block text-sm font-medium">Tu nombre
            <input className={field} required maxLength={160} autoComplete="name" value={name} onChange={e => setName(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">Teléfono o correo para responder
            <input className={field} required maxLength={160} autoComplete="off" value={contact} onChange={e => setContact(e.target.value)} />
          </label>
          <label className="block text-sm font-medium">{isOrder ? "Notas para el negocio (opcional)" : "¿Qué te gustaría consultar?"}
            <textarea className={`${field} min-h-24 resize-y`} required={!isOrder} maxLength={isOrder ? 500 : MAX_REQUEST_MESSAGE}
              placeholder={isOrder ? origin === "onsite" ? "Por ejemplo: estoy en la mesa 4." : "Por ejemplo: me gustaría recogerlo a las 2:00 p. m." : "Cuéntale al negocio qué necesitas."}
              value={note} onChange={e => setNote(e.target.value)} />
          </label>
        </fieldset>
        <p id="request-conditions" className="text-xs leading-relaxed text-kova-muted">{isOrder
          ? "Al enviar, el negocio recibe una solicitud de pedido pendiente de aceptación. No confirma una reserva o pago, ni te suscribe a campañas."
          : "El negocio revisará tu consulta. Esto no confirma un pedido, reserva o pago, ni te suscribe a campañas."}</p>
        {tooLong && <p role="alert" className="text-sm text-destructive">La solicitud supera los 1,000 caracteres. Quita algún producto o acorta las notas para enviarla completa.</p>}
        {!online && <p role="status" className="text-sm text-kova-muted">Sin conexión. Tu selección sigue aquí; conéctate para enviarla. Mantén esta página abierta.</p>}
        {error && <div role="alert" ref={feedback} tabIndex={-1} className="rounded-xl border border-destructive/30 p-3 text-sm text-destructive outline-none">{error}</div>}
        <Button type="submit" className="h-auto min-h-12 w-full whitespace-normal rounded-xl py-3" aria-describedby="request-conditions"
          disabled={busy || !online || !valid}>{busy ? "Enviando solicitud…" : isOrder ? "Enviar solicitud de pedido" : "Enviar solicitud al negocio"}<Check aria-hidden="true" /></Button>
        <p className="text-center text-xs text-kova-muted">{isOrder && lines.length === 0 ? "Agrega al menos un producto para pedir." : "La respuesta llegará al contacto que indiques."}</p>
      </form>}
    </div>
  </section>;
}
