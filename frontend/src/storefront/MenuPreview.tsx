import { useEffect, useState } from "react";
import { LivePreview } from "@/components/ui/live-preview";
import { DevicePreview, type PreviewDevice } from "@/components/ui/device-preview";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { CatalogContent, type PublicCatalog } from "./StorefrontView";

export type MenuDraft = {
  enabled: boolean;
  title: string;
  description: string | null;
  whatsapp_phone: string | null;
  product_ids: string[];
};

const validPhone = (value: string | null) => !!value && /^[1-9][0-9]{9,14}$/.test(value.trim());

/**
 * The real public menu page (same component, same server projection) for the
 * unsaved draft, inside a phone or computer viewport. The server builds the
 * payload with the public endpoint's rules, so order, availability and the
 * loyalty and order buttons match what customers get.
 */
export function MenuPreview({
  draft,
  loadPreview,
  className,
}: {
  draft: MenuDraft;
  loadPreview: (draft: MenuDraft) => Promise<PublicCatalog>;
  className?: string;
}) {
  const [device, setDevice] = useState<PreviewDevice>("phone");
  const [data, setData] = useState<PublicCatalog | null>(null);
  const [failed, setFailed] = useState(false);
  // Only send what the server would accept, so a half-typed phone never blanks the preview.
  const request: MenuDraft = {
    enabled: draft.enabled,
    title: draft.title.trim() || "Nombre de tu menú",
    description: draft.description?.trim() || null,
    whatsapp_phone: validPhone(draft.whatsapp_phone) ? draft.whatsapp_phone!.trim() : null,
    product_ids: draft.product_ids,
  };
  const key = JSON.stringify(request);
  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      loadPreview(JSON.parse(key) as MenuDraft)
        .then(result => { if (active) { setData(result); setFailed(false); } })
        .catch(() => { if (active) setFailed(true); });
    }, 350);
    return () => { active = false; window.clearTimeout(timer); };
  }, [key, loadPreview]);

  const count = data?.products.length ?? 0;
  const summary = data
    ? `Menú ${draft.enabled ? "marcado para publicar" : "sin publicar"} con el título ${data.title}, ${count} ${count === 1 ? "producto" : "productos"}${data.whatsapp_phone ? " y botón para consultar por WhatsApp" : ""}.`
    : "Preparando la vista previa del menú.";
  return (
    <LivePreview
      label="Vista previa del menú público"
      summary={summary}
      className={className}
      selfContained
      controls={<SegmentedControl ariaLabel="Ver el menú en" value={device} onValueChange={setDevice}
        options={[{ value: "phone", label: "Teléfono" }, { value: "computer", label: "Computadora" }]} />}
      note={<>
        {!draft.enabled && <p className="mb-1 font-medium text-kova-ink">Aún no está publicado: tus clientes no lo verán hasta que actives “Publicar catálogo” y guardes.</p>}
        {failed && data && <p className="mb-1 text-kova-ink">No pudimos actualizar la vista previa. Tus cambios no se pierden; revisa tu conexión.</p>}
        <p>Es la misma página que abren tus clientes, con la disponibilidad actual de tu inventario. Puedes desplazarla para verla completa.</p>
      </>}
    >
      {data ? (
        <DevicePreview device={device} title="Vista previa del menú público">
          <main className="min-h-screen bg-[#FAFAF7] text-kova-ink">
            <CatalogContent data={data} token="vista-previa" preview />
          </main>
        </DevicePreview>
      ) : failed ? (
        <p className="rounded-2xl border border-kova-border bg-white p-5 text-sm">No pudimos preparar la vista previa. Revisa tu conexión y vuelve a intentar.</p>
      ) : (
        <SectionSkeleton label="Preparando vista previa del menú…" variant="summary" />
      )}
    </LivePreview>
  );
}
