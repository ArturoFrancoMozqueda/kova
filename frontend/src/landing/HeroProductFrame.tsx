import { copy } from "@/i18n/messages";

// Device frames use current app captures, without baking the UI into a mockup.

export default function HeroProductFrame() {
  return (
    <figure className="lp-hero-frame">
      <div className="lp-hero-frame-screen">
        <img
          src="/showcase/current/register.jpg"
          alt={copy.landing.hero.desktopAlt}
          className="lp-hero-product-capture"
          width={2160}
          height={1350}
          loading="eager"
          {...{ fetchpriority: "high" }}
          decoding="async"
        />
      </div>
      <div className="lp-hero-phone">
        <img
          src="/showcase/current/mobile/dashboard.jpg"
          alt={copy.landing.hero.mobileAlt}
          width={585}
          height={1266}
          loading="eager"
          decoding="async"
        />
      </div>
      <figcaption className="lp-hero-caption">{copy.landing.hero.caption}</figcaption>
    </figure>
  );
}
