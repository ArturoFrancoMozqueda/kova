import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type PublicCatalog = { title: string; description: string | null; whatsapp_phone: string | null; products: { id: string; name: string; description: string | null; price_amount: string; availability: "available" | "unavailable" }[]; checkout_available: boolean };
const money = (value: string) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN" }).format(Number(value));

export default function StorefrontView() {
  const { token } = useParams();
  const [data, setData] = useState<PublicCatalog | null>(null);
  const [error, setError] = useState("");
  useDocumentTitle(data?.title ?? "Catálogo");
  useEffect(() => {
    const controller = new AbortController();
    setData(null); setError("");
    void fetch(`/api/v1/public/catalog/${encodeURIComponent(token ?? "")}`, { signal: controller.signal, credentials: "omit", cache: "no-store" })
      .then(async response => { if (!response.ok) throw new Error(response.status === 404 ? "Este catálogo ya no está disponible." : "No pudimos consultar el catálogo. Intenta más tarde."); return await response.json() as PublicCatalog; })
      .then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "No pudimos consultar el catálogo."); });
    return () => controller.abort();
  }, [token]);
  return <main className="min-h-screen bg-kova-mist px-4 py-10 sm:px-8 sm:py-16"><div className="mx-auto max-w-5xl">
    {error ? <div role="alert" className="rounded-2xl bg-white p-8"><h1 className="text-2xl font-semibold">Catálogo no disponible</h1><p className="mt-3">{error}</p></div> : !data ? <p role="status">Cargando catálogo…</p> : <>
      <header className="mb-10 max-w-2xl"><p className="mb-3 text-xs uppercase tracking-widest text-kova-muted">Catálogo del negocio</p><h1 className="break-words text-4xl font-semibold tracking-tight text-kova-ink sm:text-5xl">{data.title}</h1>{data.description && <p className="mt-5 break-words text-lg text-kova-muted">{data.description}</p>}<p className="mt-4 text-sm text-kova-muted">Precios en MXN. Confirma disponibilidad y condiciones con el negocio antes de comprar.</p></header>
      {data.products.length === 0 && <p>No hay productos publicados por el momento.</p>}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{data.products.map(product => <article key={product.id} className="flex min-w-0 flex-col rounded-2xl border border-kova-border bg-white p-6"><h2 className="break-words text-xl font-semibold">{product.name}</h2>{product.description && <p className="mt-3 break-words text-sm text-kova-muted">{product.description}</p>}<p className="mt-5 text-2xl font-semibold">{money(product.price_amount)}</p><p className="mt-2 text-sm">{product.availability === "available" ? "Disponible para consultar" : "Agotado por el momento"}</p>{data.whatsapp_phone && /^[1-9][0-9]{9,14}$/.test(data.whatsapp_phone) && <a className="mt-5 inline-flex min-h-11 items-center justify-center rounded-xl bg-kova-ink px-4 py-3 text-center text-sm text-white" href={`https://wa.me/${data.whatsapp_phone}?text=${encodeURIComponent(`Hola, vi ${product.name} en su catálogo. ¿Me dan información para hacer un pedido?`)}`} target="_blank" rel="noreferrer">Consultar por WhatsApp</a>}</article>)}</div>
      <footer className="mt-10 text-sm text-kova-muted">Consulta sin reserva ni cobro automático. Catálogo compartido con Kova.</footer>
    </>}
  </div></main>;
}
