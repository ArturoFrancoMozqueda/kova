/** Responsive captures of the current app; example data stays in marketing. */
export default function ProductCapture({
  screen,
  alt,
  className,
}: {
  screen: "register" | "inventory" | "shifts" | "reports";
  alt: string;
  className?: string;
}) {
  return (
    <picture>
      <source media="(max-width: 600px)" srcSet={`/showcase/current/mobile/${screen}.jpg`} width={585} height={1266} />
      <img
        src={`/showcase/current/${screen}.jpg`}
        alt={alt}
        width={2160}
        height={1350}
        loading="lazy"
        decoding="async"
        className={className}
      />
    </picture>
  );
}
