import { useEffect, useRef, useState, type FormEvent } from "react";
import { useParams } from "react-router-dom";
import { useOptionalAuth } from "@/auth/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { ProductPhoto, type ProductPhotoData } from "./ProductPhoto";

type PublicCatalog = {
  title: string;
  description: string | null;
  whatsapp_phone: string | null;
  products: (ProductPhotoData & {
    id: string;
    name: string;
    description: string | null;
    price_amount: string;
    availability: "available" | "unavailable";
  })[];
  checkout_available: boolean;
};
const money = (value: string) =>
  new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(
    Number(value),
  );

export default function StorefrontView() {
  const { token } = useParams();
  const auth = useOptionalAuth();
  const [data, setData] = useState<PublicCatalog | null>(null);
  const [error, setError] = useState("");
  useDocumentTitle(data?.title ?? "Catálogo");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void fetch(`/api/v1/public/catalog/${encodeURIComponent(token ?? "")}`, {
      signal: controller.signal,
      credentials: "omit",
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok)
          throw new Error(
            response.status === 404
              ? "Este catálogo ya no está disponible."
              : "No pudimos consultar el catálogo. Intenta más tarde.",
          );
        return (await response.json()) as PublicCatalog;
      })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error
              ? e.message
              : "No pudimos consultar el catálogo.",
          );
      });
    return () => controller.abort();
  }, [token]);
  // AuthProvider intentionally remounts routes when identity resolves. Do not
  // accept public form input until that initial boundary is stable.
  if (auth?.state.status === "loading")
    return (
      <main className="min-h-screen bg-kova-mist p-8">
        <p role="status">Preparando catálogo…</p>
      </main>
    );
  return (
    <main className="min-h-screen bg-kova-mist px-4 py-10 sm:px-8 sm:py-16">
      <div className="mx-auto max-w-5xl">
        {error ? (
          <div role="alert" className="rounded-2xl bg-white p-8">
            <h1 className="text-2xl font-semibold">Catálogo no disponible</h1>
            <p className="mt-3">{error}</p>
          </div>
        ) : !data ? (
          <p role="status">Cargando catálogo…</p>
        ) : (
          <CatalogContent key={token} token={token ?? ""} data={data} />
        )}
      </div>
    </main>
  );
}

function CatalogContent({ data, token }: { data: PublicCatalog; token: string }) {
  const [productIds, setProductIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(false);
  const toggleProduct = (id: string) => {
    if (busy || received) return;
    setProductIds(ids => ids.includes(id) ? ids.filter(value => value !== id)
      : ids.length < 20 ? [...ids, id] : ids);
  };
  return (
    <>
      <header className="mb-10 max-w-2xl">
        <p className="mb-3 text-xs uppercase tracking-widest text-kova-muted">
          Catálogo del negocio
        </p>
        <h1 className="break-words text-4xl font-semibold tracking-tight text-kova-ink sm:text-5xl">
          {data.title}
        </h1>
        {data.description && (
          <p className="mt-5 break-words text-lg text-kova-muted">
            {data.description}
          </p>
        )}
        <p className="mt-5 text-base text-kova-ink">
          Explora los productos, selecciona los que te interesan y deja tu consulta al negocio.
        </p>
        <p className="mt-4 text-sm text-kova-muted">
          Precios en MXN. Confirma disponibilidad y condiciones con el
          negocio antes de comprar.
        </p>
      </header>
      {data.products.length === 0 && (
        <p>No hay productos publicados por el momento.</p>
      )}
      {!received && productIds.length > 0 && <div className="sticky top-3 z-10 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-kova-border bg-white p-4 shadow-sm">
        <p role="status" className="text-sm">{productIds.length} {productIds.length === 1 ? "producto seleccionado" : "productos seleccionados"} para consultar</p>
        <a href="#solicitud-catalogo" className="inline-flex min-h-11 items-center rounded-xl bg-kova-ink px-4 text-sm text-white">Continuar con mi consulta</a>
      </div>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.products.map((product) => (
          <article
            key={product.id}
            className="flex min-w-0 flex-col rounded-2xl border border-kova-border bg-white p-6"
          >
            <div className="-mx-6 -mt-6 mb-5">
              <ProductPhoto product={product} />
            </div>
            <h2 className="break-words text-xl font-semibold">
              {product.name}
            </h2>
            {product.description && (
              <p className="mt-3 break-words text-sm text-kova-muted">
                {product.description}
              </p>
            )}
            <p className="mt-5 text-2xl font-semibold">
              {money(product.price_amount)}
            </p>
            <p className="mt-2 text-sm">
              {product.availability === "available"
                ? "Disponible para consultar"
                : "Agotado por el momento"}
            </p>
            <button
              type="button"
              aria-pressed={productIds.includes(product.id)}
              aria-label={`${productIds.includes(product.id) ? "Quitar" : "Seleccionar"} ${product.name} para consultar`}
              disabled={busy || received || (!productIds.includes(product.id) && productIds.length >= 20)}
              onClick={() => toggleProduct(product.id)}
              className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl border border-kova-border px-4 py-3 text-sm font-medium text-kova-ink aria-pressed:border-kova-blue aria-pressed:bg-kova-mist focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue disabled:opacity-50"
            >
              {productIds.includes(product.id) ? "Seleccionado para consultar" : "Me interesa"}
            </button>
            {data.whatsapp_phone &&
              /^[1-9][0-9]{9,14}$/.test(data.whatsapp_phone) && (
                <a
                  className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-kova-ink px-4 py-3 text-center text-sm text-white"
                  href={`https://wa.me/${data.whatsapp_phone}?text=${encodeURIComponent(`Hola, vi ${product.name} en su catálogo. ¿Me dan información para hacer un pedido?`)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Consultar por WhatsApp
                </a>
              )}
          </article>
        ))}
      </div>
      <CatalogRequestForm
        token={token}
        products={data.products}
        productIds={productIds}
        onProductToggle={toggleProduct}
        busy={busy}
        setBusy={setBusy}
        received={received}
        onReceived={() => setReceived(true)}
      />
      <footer className="mt-10 text-sm text-kova-muted">
        Consulta sin reserva ni cobro automático. Catálogo compartido con
        Kova.
      </footer>
    </>
  );
}

function CatalogRequestForm({
  token,
  products, productIds, onProductToggle, busy, setBusy, received, onReceived,
}: {
  token: string;
  products: PublicCatalog["products"];
  productIds: string[];
  onProductToggle: (id: string) => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
  received: boolean;
  onReceived: () => void;
}) {
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const command = useRef<{ fingerprint: string; id: string } | null>(null);
  const controller = useRef(new AbortController());
  const lock = useRef(false);
  useEffect(() => {
    controller.current = new AbortController();
    const current = controller.current;
    return () => current.abort();
  }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    const fields = {
      name: name.trim(),
      contact: contact.trim(),
      message: message.trim(),
      product_ids: productIds,
    };
    const fingerprint = JSON.stringify(fields);
    if (command.current?.fingerprint !== fingerprint)
      command.current = { fingerprint, id: crypto.randomUUID() };
    try {
      const response = await fetch(
        `/api/v1/public/catalog/${encodeURIComponent(token)}/requests`,
        {
          method: "POST",
          credentials: "omit",
          cache: "no-store",
          signal: controller.current.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...fields,
            submission_id: command.current.id,
          }),
        },
      );
      if (!response.ok)
        throw new Error(
          response.status === 429
            ? "Recibimos varias solicitudes. Espera un momento antes de volver a intentar."
            : response.status === 404
              ? "Este catálogo ya no está disponible para solicitudes."
              : "No pudimos registrar tu solicitud. Revisa los datos y vuelve a intentar.",
        );
      if (!controller.current.signal.aborted) onReceived();
    } catch (e) {
      if (!controller.current.signal.aborted)
        setError(
          e instanceof Error ? e.message : "No pudimos registrar tu solicitud.",
        );
    } finally {
      lock.current = false;
      if (!controller.current.signal.aborted) setBusy(false);
    }
  };
  const field =
    "mt-1 min-h-11 w-full rounded-xl border border-kova-border bg-white p-3";
  return (
    <section
      id="solicitud-catalogo"
      tabIndex={-1}
      className="mt-10 scroll-mt-32 rounded-2xl border border-kova-border bg-white p-6 sm:p-8"
      aria-label="Solicitud al negocio"
    >
      <h2 className="text-2xl font-semibold">Deja tu solicitud al negocio</h2>
      <p className="mt-3 max-w-2xl text-sm text-kova-muted">
        El negocio revisará tu consulta y podrá responder al contacto que
        indiques. Esto no confirma un pedido, reserva o pago, ni te suscribe a
        campañas.
      </p>
      {received ? (
        <p role="status" className="mt-5 rounded-xl bg-kova-mist p-5">
          Solicitud recibida. El negocio revisará los datos para continuar
          contigo.
        </p>
      ) : (
        <form
          className="mt-6 space-y-4"
          onSubmit={(event) => void submit(event)}
        >
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="text-sm">
              Tu nombre
              <input
                className={field}
                required
                maxLength={160}
                autoComplete="name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="text-sm">
              Teléfono o correo para responder
              <input
                className={field}
                required
                maxLength={160}
                autoComplete="off"
                value={contact}
                onChange={(event) => setContact(event.target.value)}
              />
            </label>
          </div>
          <label className="block text-sm">
            ¿Qué te gustaría consultar?
            <textarea
              className={field}
              required
              maxLength={1000}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </label>
          <fieldset>
            <legend className="text-sm font-medium">
              Productos de tu consulta (opcional, hasta 20)
            </legend>
            <p className="mt-2 break-words text-sm text-kova-muted">
              {productIds.length > 0
                ? `Tu selección: ${products.filter(product => productIds.includes(product.id)).map(product => product.name).join(", ")}.`
                : "Puedes seleccionar productos arriba o dejar una consulta general."}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {products.map((product) => (
                <label
                  key={product.id}
                  className="flex min-h-11 min-w-0 items-center gap-3 text-sm"
                >
                  <input
                    type="checkbox"
                    checked={productIds.includes(product.id)}
                    disabled={
                      busy || (!productIds.includes(product.id) &&
                      productIds.length >= 20)
                    }
                    onChange={() => onProductToggle(product.id)}
                  />
                  <span className="break-words">{product.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <button
            className="inline-flex min-h-11 items-center justify-center rounded-xl bg-kova-ink px-5 py-3 text-sm text-white disabled:opacity-50"
            disabled={
              busy || !name.trim() || !contact.trim() || !message.trim()
            }
          >
            {busy ? "Registrando solicitud…" : "Enviar solicitud al negocio"}
          </button>
        </form>
      )}
    </section>
  );
}
