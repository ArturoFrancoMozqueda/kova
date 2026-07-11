/** Narrative-arc divider: an uppercase, tracked-out kicker that makes the
 * structure between blocks explicit (e.g. Reportes: Resumen → Qué hacer → Por
 * qué → Operación; Panel: Hoy → Qué hacer → Salud del negocio). Shared so every
 * tab labels its sections the same way. `id` supports scroll-to anchors. */
export function ArcKicker({ label, id }: { label: string; id?: string }) {
  return (
    <p
      id={id}
      className="scroll-mt-14 pt-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-kova-tertiary"
    >
      {label}
    </p>
  );
}
