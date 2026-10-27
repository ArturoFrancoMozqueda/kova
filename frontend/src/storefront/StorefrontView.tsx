import { useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { ArrowDownUp, ArrowLeft, ArrowRight, ArrowUpRight, CheckCircle2, Search, ShoppingBag, UtensilsCrossed, X } from "lucide-react";
import { useOptionalAuth } from "@/auth/useAuth";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { MembershipEntry } from "@/loyaltyCard/MembershipEntry";
import { StorefrontRequest } from "./StorefrontRequest";
import { MenuProductCard } from "./MenuProductCard";
import { MenuProductDetails } from "./MenuProductDetails";
import {
  MAX_MENU_PRODUCTS, MAX_MENU_QUANTITY, browseMenu, menuMoney, menuSubtotal,
  type MenuProduct, type MenuSort,
} from "./menu";

type PublicCatalog = {
  title: string;
  description: string | null;
  whatsapp_phone: string | null;
  products: MenuProduct[];
  checkout_available: boolean;
  loyalty_available?: boolean;
};
class MenuReadError extends Error {}

export default function StorefrontView() {
  const { token } = useParams();
  const auth = useOptionalAuth();
  const [data, setData] = useState<PublicCatalog | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useDocumentTitle(data?.title ?? "Menú digital");
  useEffect(() => {
    const controller = new AbortController();
    setData(null);
    setError("");
    void fetch(`/api/v1/public/catalog/${encodeURIComponent(token ?? "")}`, {
      signal: controller.signal, credentials: "omit", cache: "no-store",
    }).then(async response => {
      if (!response.ok) throw new MenuReadError(response.status === 404 || response.status === 410
        ? "Este catálogo ya no está disponible."
        : "No pudimos consultar el menú. Intenta de nuevo.");
      return await response.json() as PublicCatalog;
    }).then(result => {
      if (!controller.signal.aborted) setData(result);
    }).catch(e => {
      if (!controller.signal.aborted) setError(e instanceof MenuReadError ? e.message : "No pudimos cargar el menú. Revisa tu conexión e intenta de nuevo.");
    });
    return () => controller.abort();
  }, [token, attempt]);
  // AuthProvider remounts routes when identity resolves. Wait before accepting input.
  if (auth?.state.status === "loading") return <main className="min-h-screen bg-kova-mist p-8"><p role="status">Preparando menú…</p></main>;
  return <main className="min-h-screen bg-[#FAFAF7] text-kova-ink">
    {error ? <div role="alert" className="mx-auto max-w-xl px-5 py-20">
      <h1 className="text-2xl font-semibold">Menú no disponible</h1><p className="mt-3 text-kova-muted">{error}</p>
      <Button className="mt-5" variant="outline" onClick={() => setAttempt(value => value + 1)}>Volver a intentar</Button>
    </div> : !data ? <div className="mx-auto max-w-6xl px-5 py-16"><p role="status">Cargando menú…</p></div>
      : <CatalogContent key={token} token={token ?? ""} data={data} />}
  </main>;
}

function CatalogContent({ data, token }: { data: PublicCatalog; token: string }) {
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [onlyAvailable, setOnlyAvailable] = useState(false);
  const [sort, setSort] = useState<MenuSort>("published");
  const [busy, setBusy] = useState(false);
  const [received, setReceived] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [requestMode, setRequestMode] = useState<"order" | "question">("order");
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailProduct = data.products.find(product => product.id === detailId) ?? null;
  const review = useRef<HTMLElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const menuScroll = useRef(0);
  useEffect(() => {
    if (reviewOpen) {
      review.current?.focus({ preventScroll: true });
      window.scrollTo({ top: 0 });
    } else if (returnFocus.current) {
      returnFocus.current.focus({ preventScroll: true });
      window.scrollTo({ top: menuScroll.current });
      returnFocus.current = null;
    }
  }, [reviewOpen]);
  const openReview = (mode?: "order" | "question") => {
    menuScroll.current = window.scrollY;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (mode && !busy && !received) setRequestMode(mode);
    setReviewOpen(true);
  };
  const lines = data.products.filter(product => quantities[product.id] > 0)
    .map(product => ({ product, quantity: quantities[product.id] }));
  const count = lines.reduce((total, line) => total + line.quantity, 0);
  const subtotal = menuSubtotal(lines);
  const products = browseMenu(data.products, { query, onlyAvailable, sort });
  const priorityPhotoId = products.find(product => product.image_url)?.id;
  const whatsapp = data.whatsapp_phone && /^[1-9][0-9]{9,14}$/.test(data.whatsapp_phone)
    ? `https://wa.me/${data.whatsapp_phone}?text=${encodeURIComponent(`Hola, estoy viendo el menú de ${data.title}. ¿Me ayudan con una consulta?`)}` : null;
  const changeQuantity = (id: string, quantity: number) => {
    if (busy || received || !Number.isInteger(quantity) || quantity < 0 || quantity > MAX_MENU_QUANTITY) return;
    const product = data.products.find(row => row.id === id);
    if (!product || product.availability !== "available") return;
    setQuantities(current => {
      if (!current[id] && Object.values(current).filter(value => value > 0).length >= MAX_MENU_PRODUCTS) return current;
      if (quantity === 0) {
        const next = { ...current };
        delete next[id];
        return next;
      }
      return { ...current, [id]: quantity };
    });
  };

  return <>
    <a href={reviewOpen ? "#mi-pedido" : "#menu"} className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:rounded-xl focus:bg-white focus:p-4 focus:text-kova-blue">{reviewOpen ? "Saltar al pedido" : "Saltar al menú"}</a>
    <div className="border-b border-kova-border bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2 sm:px-8 lg:py-4">
        <span className="flex items-center gap-2 text-xs font-medium lg:text-sm"><UtensilsCrossed className="h-4 w-4 text-kova-blue" aria-hidden="true" />Menú digital</span>
        <Button type="button" variant="ghost" className="px-2 lg:hidden" onClick={() => reviewOpen ? setReviewOpen(false) : openReview()}>
          {reviewOpen ? <><ArrowLeft aria-hidden="true" />Volver al menú</> : <><ShoppingBag aria-hidden="true" />Mi pedido{count > 0 && <span className="rounded-full bg-kova-ink px-2 py-0.5 text-xs text-white">{count}</span>}</>}
        </Button>
        <a href="#mi-pedido" className="hidden min-h-11 items-center gap-2 rounded-full border border-kova-border px-4 text-sm font-medium lg:inline-flex">
          <ShoppingBag className="h-4 w-4" aria-hidden="true" />Mi pedido{count > 0 && <span className="rounded-full bg-kova-ink px-2 py-0.5 text-xs text-white">{count}</span>}
        </a>
      </div>
    </div>
    <header className={`${reviewOpen ? "hidden lg:block " : ""}border-b border-kova-border bg-white`}>
      <div className="mx-auto grid max-w-6xl gap-2 px-4 pb-4 pt-4 sm:px-8 lg:grid-cols-[1fr_auto] lg:items-end lg:gap-8 lg:py-12">
        <div className="min-w-0 max-w-2xl">
          <p className="mb-4 hidden text-xs font-semibold uppercase tracking-[0.18em] text-kova-muted lg:block">Elige a tu gusto</p>
          <h1 className="break-words text-2xl font-semibold tracking-tight lg:text-5xl">{data.title}</h1>
          {data.description && <p className="mt-2 max-w-xl break-words text-sm leading-relaxed text-kova-muted lg:mt-4 lg:text-base">{data.description}</p>}
          <p className="mt-5 hidden max-w-xl text-sm leading-relaxed lg:block">Estés aquí o a distancia, arma tu pedido y envíalo al negocio para que lo revise y confirme contigo.</p>
          <div className="mt-5 hidden flex-wrap gap-x-5 gap-y-2 text-xs text-kova-muted lg:flex">
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Precios en MXN</span>
            <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Sin crear una cuenta</span>
          </div>
        </div>
        {(typeof data.loyalty_available === "boolean" || whatsapp) && <div className="space-y-3 lg:w-80">
        {typeof data.loyalty_available === "boolean" && <MembershipEntry menuToken={token} businessName={data.title} available={data.loyalty_available} />}
        {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer" className="hidden min-h-11 w-fit items-center gap-2 rounded-full border border-kova-border px-5 text-sm font-medium lg:inline-flex">
          Consultar por WhatsApp<ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>}
        </div>}
      </div>
    </header>
    <div className={`mx-auto max-w-6xl px-4 py-4 sm:px-8 lg:py-10 ${count > 0 && !reviewOpen ? "pb-28 lg:pb-10" : ""}`}>
      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_360px] xl:gap-10">
        <section id="menu" tabIndex={-1} aria-labelledby="menu-title" className={`${reviewOpen ? "hidden lg:block " : ""}min-w-0 scroll-mt-6`}>
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2 lg:mb-5"><h2 id="menu-title" className="text-lg font-semibold tracking-tight lg:text-2xl">Nuestro menú</h2>
            <span id="menu-results" role="status" aria-atomic="true" className="text-xs text-kova-muted lg:text-sm">{query.trim() || onlyAvailable ? `${products.length} de ${data.products.length}` : data.products.length} {data.products.length === 1 ? "producto" : "productos"} · <span className="lg:hidden">MXN</span><span className="hidden lg:inline">precios en MXN</span></span></div>
          {data.products.length > 0 && <>
            <div className="relative">
            <label className="relative block"><span className="sr-only">Buscar en el menú</span>
              <Search className="pointer-events-none absolute left-4 top-3.5 h-5 w-5 text-kova-muted" aria-hidden="true" />
              <input ref={searchInput} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="¿Qué te gustaría pedir?"
                aria-describedby="menu-results" onKeyDown={event => { if (event.key === "Escape" && query) { event.preventDefault(); setQuery(""); } }}
                className="min-h-12 w-full appearance-none rounded-2xl border border-kova-border bg-white py-3 pl-12 pr-12 text-base focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue [&::-webkit-search-cancel-button]:appearance-none" />
            </label>
            {query && <button type="button" aria-label="Limpiar búsqueda" className="absolute right-0.5 top-0.5 flex h-11 w-11 items-center justify-center rounded-xl text-kova-muted hover:text-kova-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-kova-blue"
              onClick={() => { setQuery(""); searchInput.current?.focus(); }}><X className="h-4 w-4" aria-hidden="true" /></button>}
            </div>
            <div className="mb-4 mt-2 flex flex-wrap items-center gap-2 lg:mb-6 lg:mt-3">
            <div className="flex min-w-0 flex-wrap gap-2" role="group" aria-label="Filtrar productos">
              <Button type="button" className="rounded-full px-3 transition-[transform,box-shadow]" variant={!onlyAvailable ? "default" : "outline"} aria-pressed={!onlyAvailable} onClick={() => setOnlyAvailable(false)}>Todo el menú</Button>
              <Button type="button" className="rounded-full px-3 transition-[transform,box-shadow]" variant={onlyAvailable ? "default" : "outline"} aria-pressed={onlyAvailable} onClick={() => setOnlyAvailable(true)}>Disponibles</Button>
            </div>
            <label title="Ordenar menú" className={`relative ml-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-kova-blue ${sort === "published" ? "border-kova-border bg-white text-kova-muted" : "border-kova-blue bg-kova-mist text-kova-blue"}`}>
              <span className="sr-only">Ordenar menú</span><ArrowDownUp className="h-4 w-4" aria-hidden="true" />
              <select className="absolute inset-0 h-full w-full cursor-pointer opacity-0" value={sort} onChange={event => setSort(event.target.value as MenuSort)}>
                <option value="published">Orden del negocio</option><option value="price_asc">Precio: menor a mayor</option><option value="price_desc">Precio: mayor a menor</option><option value="name">Nombre: A a Z</option>
              </select>
            </label>
            </div>
          </>}
          {lines.length >= MAX_MENU_PRODUCTS && <p role="status" className="mb-4 rounded-xl border border-kova-border bg-white p-3 text-sm">Puedes incluir hasta 20 productos distintos por solicitud. Puedes ajustar sus cantidades.</p>}
          {data.products.length === 0 ? <div className="rounded-2xl border border-dashed border-kova-border bg-white p-8">
            <h3 className="font-semibold">El menú se está preparando</h3><p className="mt-2 text-sm text-kova-muted">No hay productos publicados por el momento. Puedes dejar una consulta al negocio.</p>
          </div> : products.length === 0 ? <div role="status" className="rounded-2xl border border-kova-border bg-white p-6">
            <p className="font-medium">No encontramos productos con estos filtros.</p><p className="mt-2 text-sm text-kova-muted">Prueba otro nombre o vuelve a ver todo el menú.</p>
            <Button type="button" variant="outline" className="mt-4" onClick={() => { setQuery(""); setOnlyAvailable(false); }}>Limpiar búsqueda y filtros</Button>
          </div> : <div className="grid grid-cols-3 items-stretch gap-2 sm:gap-3 lg:grid-cols-1">
            {products.map(product => <MenuProductCard key={product.id} product={product} quantity={quantities[product.id] ?? 0} priority={product.id === priorityPhotoId}
              disabled={busy || received} cannotAdd={lines.length >= MAX_MENU_PRODUCTS}
              onQuantityChange={value => changeQuantity(product.id, value)} onDetails={() => setDetailId(product.id)} />)}
          </div>}
          <div className="mt-3 flex flex-wrap items-center gap-x-4 lg:hidden">
            <Button type="button" variant="link" className="px-0" disabled={busy || received} onClick={() => openReview("question")}>Hacer una consulta</Button>
            {whatsapp && <a href={whatsapp} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 text-sm text-kova-muted underline">WhatsApp<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></a>}
          </div>
        </section>
        <aside ref={review} tabIndex={-1} aria-label="Revisar pedido" className={`${reviewOpen ? "" : "hidden lg:block "}min-w-0 focus:outline-none`}>
          <StorefrontRequest token={token} lines={lines} onQuantityChange={changeQuantity} mode={requestMode} setMode={setRequestMode}
            busy={busy} setBusy={setBusy} received={received} onReceived={() => setReceived(true)} onBrowse={() => setReviewOpen(false)} />
        </aside>
      </div>
      <footer className="mt-5 border-t border-kova-border py-4 text-xs leading-relaxed text-kova-muted lg:mt-10 lg:py-6">
        <p>Menú compartido con <span className="font-semibold text-kova-ink">Kova</span></p>
        <p className="mt-2">Cada solicitud queda pendiente de aceptación por el negocio. No se realizan reservas ni cobros automáticos.</p>
      </footer>
    </div>
    {count > 0 && <div className={`${reviewOpen ? "hidden " : ""}fixed inset-x-0 bottom-0 z-20 border-t border-kova-border bg-white px-4 pt-3 lg:hidden`} style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}>
      <button type="button" onClick={() => openReview()} className="mx-auto flex min-h-14 w-full max-w-xl items-center justify-between gap-3 rounded-2xl bg-kova-ink px-4 py-3 text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kova-blue">
        <span className="flex items-center gap-2 text-sm"><ShoppingBag className="h-5 w-5" aria-hidden="true" /><span className="font-semibold">{received ? "Ver solicitud enviada" : "Ver mi pedido"}</span><span className="rounded-full bg-white/15 px-2 py-0.5 text-xs">{count}</span></span>
        <span className="flex items-center gap-2 text-sm font-semibold tabular-nums">{menuMoney(subtotal)}<ArrowRight className="h-4 w-4" aria-hidden="true" /></span>
      </button>
      <p role="status" className="sr-only">{count} {count === 1 ? "artículo" : "artículos"} en tu pedido. Subtotal estimado: {menuMoney(subtotal)} MXN.</p>
    </div>}
    <MenuProductDetails product={detailProduct} quantity={detailId ? quantities[detailId] ?? 0 : 0}
      disabled={busy || received} cannotAdd={lines.length >= MAX_MENU_PRODUCTS}
      onQuantityChange={value => { if (detailId) changeQuantity(detailId, value); }} onClose={() => setDetailId(null)} />
  </>;
}
