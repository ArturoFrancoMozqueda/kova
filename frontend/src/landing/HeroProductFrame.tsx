// Vista estática y sanitizada de la Caja productiva. La captura se presenta
// como evidencia del producto, sin chrome de navegador ni estados decorativos.

export default function HeroProductFrame() {
  return (
    <figure className="lp-hero-frame">
      <figcaption className="lp-hero-frame-caption">
        <strong>Caja</strong>
        <span>Captura real sanitizada</span>
      </figcaption>
      <div className="lp-hero-frame-screen">
        <img
          src="/showcase/register.png"
          alt="Vista real sanitizada de la Caja de Kova con un carrito de $186.00"
          className="lp-hero-product-capture"
          width={1440}
          height={900}
          loading="eager"
          decoding="async"
        />
      </div>
    </figure>
  );
}
