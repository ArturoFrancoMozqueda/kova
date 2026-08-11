// Vista de Kova en escritorio y móvil. La captura se presenta como evidencia
// del producto, sin chrome de navegador ni estados decorativos.

export default function HeroProductFrame() {
  return (
    <figure className="lp-hero-frame">
      <div className="lp-hero-frame-screen">
        <img
          src="/showcase/kova-laptop-mobile.webp"
          alt="Kova funcionando en una laptop y un teléfono con Caja y Análisis"
          className="lp-hero-product-capture"
          width={1536}
          height={1024}
          loading="eager"
          decoding="async"
        />
      </div>
    </figure>
  );
}
