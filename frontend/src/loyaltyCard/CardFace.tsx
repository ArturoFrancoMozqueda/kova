import type { ReactNode } from "react";
import { Gift } from "lucide-react";

export type CardAppearance = {
  color: string;
  use_business_logo: boolean;
  logo_url?: string | null;
  version?: number;
};
export const defaultCardColor = "#0F1117";
export function cardTextColor(value: string): "#FFFFFF" | "#000000" {
  const color = /^#[0-9a-f]{6}$/i.test(value) ? value : defaultCardColor;
  const channels = [1, 3, 5]
    .map((start) => parseInt(color.slice(start, start + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance =
    channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 4.5 ? "#000000" : "#FFFFFF";
}
export function CardFace({
  appearance,
  businessName,
  label,
  children,
}: {
  appearance?: CardAppearance | null;
  businessName?: string;
  label: string;
  children: ReactNode;
}) {
  const color =
    appearance && /^#[0-9a-f]{6}$/i.test(appearance.color)
      ? appearance.color
      : defaultCardColor;
  const logo =
    appearance?.use_business_logo &&
    appearance.logo_url?.startsWith("/api/v1/settings/receipt/logo/")
      ? appearance.logo_url
      : null;
  return (
    <section
      aria-label={label}
      style={{ backgroundColor: color, color: cardTextColor(color) }}
      className="relative isolate flex min-h-44 flex-col justify-between gap-4 overflow-hidden rounded-3xl p-5 shadow-lg transition-colors duration-300 motion-reduce:transition-none sm:p-6"
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-20 -top-24 -z-10 h-72 w-72 rounded-full border border-current opacity-10"
      />
      <div className="flex min-w-0 items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-medium uppercase tracking-[.15em]">
            Tarjeta de lealtad
          </p>
          {businessName && (
            <p className="mt-1 break-words text-sm font-semibold">
              {businessName}
            </p>
          )}
        </div>
        {logo ? (
          <img
            src={logo}
            alt="Logo del negocio"
            className="h-11 w-11 shrink-0 rounded-lg bg-white object-contain p-1"
          />
        ) : (
          <Gift className="h-6 w-6 shrink-0" aria-hidden="true" />
        )}
      </div>
      {children}
    </section>
  );
}
