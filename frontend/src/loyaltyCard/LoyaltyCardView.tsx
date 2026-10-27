import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { LoyaltyCardScreen, type PublicLoyaltyCardData } from "./LoyaltyCardScreen";
import { clearMembershipKey, loadMembership, pendingMembershipKey, type Membership } from "./membership";
import { MembershipEntry } from "./MembershipEntry";
import { resolveUserFacingError } from "@/lib/apiError";

export default function LoyaltyCardView() {
  const { hash, search } = useLocation();
  // The capability stays in the fragment: it is never part of a page request,
  // a referrer, browser storage, or a customer identity lookup.
  const token = hash.slice(1);
  const menuToken = new URLSearchParams(search).get("menu");
  if (!token && menuToken) return <MemberCardContent key={menuToken} menuToken={menuToken} />;
  return <LoyaltyCardContent key={token} token={token} />;
}

function MemberCardContent({ menuToken }: { menuToken: string }) {
  const [membership, setMembership] = useState<Membership | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const controller = new AbortController(); setMembership(null); setError(""); setLoading(true);
    void loadMembership(menuToken, controller.signal).then(value => { if (!controller.signal.aborted) { setMembership(value); if (value.card) clearMembershipKey(menuToken, pendingMembershipKey(menuToken)); } })
      .catch(failure => { if (!controller.signal.aborted) setError(resolveUserFacingError(failure, "No pudimos consultar tu tarjeta. Revisa tu conexión e intenta de nuevo.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [menuToken, attempt]);
  if (membership && !membership.card) return <main className="min-h-screen bg-[#FAFAF7] px-4 py-10 text-kova-ink"><div className="mx-auto max-w-md space-y-5"><h1 className="text-2xl font-semibold">Tu tarjeta en {membership.business_name}</h1><p className="text-sm text-kova-muted">{membership.available ? "Obtén una tarjeta personal nueva en este navegador para tus próximas compras." : "No encontramos una tarjeta en este navegador. Consulta al equipo para acceder a tu tarjeta o revisar la disponibilidad."}</p>{membership.available && <MembershipEntry menuToken={menuToken} businessName={membership.business_name} />}<a className="inline-flex min-h-11 items-center text-sm font-medium text-kova-blue underline" href={`/catalogo/${encodeURIComponent(menuToken)}`}>Volver al menú</a></div></main>;
  return <LoyaltyCardScreen data={membership?.card ?? null} loading={loading} error={error} accessMode="device" onRefresh={() => setAttempt(value => value + 1)} />;
}

function LoyaltyCardContent({ token }: { token: string }) {
  const [data, setData] = useState<PublicLoyaltyCardData | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [loading, setLoading] = useState(Boolean(token));
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    setData(null);
    setError("");
    setLoading(true);
    void fetch("/api/v1/public/loyalty/cards", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }),
      credentials: "omit", cache: "no-store", referrerPolicy: "no-referrer", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error(response.status === 404 || response.status === 410
        ? "Este enlace ya no está disponible. Pide al negocio un enlace nuevo para tu tarjeta."
        : "No pudimos consultar tus puntos. Intenta de nuevo en un momento.");
      return await response.json() as PublicLoyaltyCardData;
    }).then(result => { if (!controller.signal.aborted) setData(result); })
      .catch(failure => { if (!controller.signal.aborted) setError(resolveUserFacingError(failure, "No pudimos consultar tus puntos. Revisa tu conexión e intenta de nuevo.")); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [token, attempt]);

  return <LoyaltyCardScreen data={data} loading={loading} error={error} missing={!token} onRefresh={() => setAttempt(value => value + 1)} />;
}
