// Cursor falso decorativo de la escena POS del showcase: entra, "hace click"
// en la galleta de avena (sincronizado con --lp-entry-delay del preview) y
// luego viaja al botón Cobrar. Puramente cosmético (aria-hidden); sus
// keyframes (ksw-cursor-*) viven en SHOWCASE_STYLES junto al resto del stage.
// Se monta solo dentro de la capa POS activa, así el remount por ciclo
// reinicia el recorrido en cada loop.
export default function ShowcaseCursor() {
  return (
    <div className="ksw-cursor" aria-hidden="true">
      <span className="ksw-cursor-ring" />
      <svg className="ksw-cursor-pointer" width="26" height="26" viewBox="0 0 24 24" fill="none">
        <path
          d="M5.5 3.2L18.6 12.2L12.9 13.4L16.2 19.9L13.6 21.2L10.3 14.7L6.4 18.9L5.5 3.2Z"
          fill="#fff"
          stroke="rgba(15,17,23,0.55)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
