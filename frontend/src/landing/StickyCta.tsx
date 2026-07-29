// Barra CTA fija de móvil: la telemetría muestra que ~92% de los visitantes
// nunca llega a #precio, así que la oferta viaja con el scroll. Reglas de
// visibilidad (todas a la vez):
//   1. viewport móvil (<768px, matchMedia),
//   2. visitante no autenticado (la barra vende el trial),
//   3. el hero-film ya salió del viewport (pastHeroFilm — cero colisión con
//      el rail/mini-CTA del scrub),
//   4. ni #precio ni #cta-final están a la vista (esas secciones cargan su
//      propio CTA dominante).
// Renderiza null cuando está oculta: sin SSR/CLS y sin ruido en jsdom.
// z-index 55 < FAB (60); la regla CSS hermana en landingTheme sube el FAB
// cuando la barra está montada. NO usa .pf-cta (contrato e2e del film).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "@/i18n/messages";
import { pastHeroFilm } from "@/landing/WhatsAppFab";

const t = copy.landing;

export default function StickyCta({
  primaryTarget,
  isAuthenticated,
  onCtaClick,
  initiallyVisible = false, // solo tests: jsdom no tiene matchMedia/scroll
}: {
  primaryTarget: string;
  isAuthenticated: boolean;
  onCtaClick: (cta: string) => void;
  initiallyVisible?: boolean;
}) {
  const [visible, setVisible] = useState(initiallyVisible);

  useEffect(() => {
    if (isAuthenticated) return;
    if (!window.matchMedia || !("IntersectionObserver" in window)) return;

    const mobileQuery = window.matchMedia("(max-width: 767px)");
    let pastFilm = false;
    const offerSectionsInView = new Set<Element>();

    const update = () => {
      setVisible(mobileQuery.matches && pastFilm && offerSectionsInView.size === 0);
    };

    // #precio y #cta-final: observación bidireccional (sin unobserve) — la
    // barra reaparece si el visitante vuelve a subir.
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) offerSectionsInView.add(entry.target);
          else offerSectionsInView.delete(entry.target);
        }
        update();
      },
      { threshold: 0 },
    );
    for (const id of ["precio", "cta-final"]) {
      const section = document.getElementById(id);
      if (section) observer.observe(section);
    }

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        pastFilm = pastHeroFilm();
        update();
      });
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    mobileQuery.addEventListener?.("change", update);

    return () => {
      observer.disconnect();
      window.removeEventListener("scroll", onScroll);
      mobileQuery.removeEventListener?.("change", update);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [isAuthenticated]);

  if (!visible) return null;

  return (
    <div className="lp-sticky-cta">
      <span style={{ fontSize: 13, color: "var(--text-muted)", minWidth: 0 }}>
        {t.stickyCta.note}
      </span>
      <Link
        to={primaryTarget}
        onClick={() => onCtaClick("sticky_mobile")}
        className="lp-cta-fill"
        style={{
          flexShrink: 0,
          background: "var(--cta-blue, var(--kova-blue))", color: "#fff",
          padding: "11px 18px", borderRadius: 10,
          fontWeight: 600, fontSize: 14, textDecoration: "none",
          display: "inline-flex", alignItems: "center",
        }}
      >
        {t.hero.ctaPrimary}
      </Link>
    </div>
  );
}
