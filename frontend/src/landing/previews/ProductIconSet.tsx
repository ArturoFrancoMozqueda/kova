// Íconos de producto Sweet Home para los previews de la landing.
// Estilo lucide (stroke 1.5, grid 24px, currentColor) dentro de un chip con
// tinte de categoría. SVG propio solo donde lucide no tiene equivalente
// (chocolate caliente, brownie, concha, panqué).
import type { CSSProperties, ReactNode } from "react";
import { CakeSlice, Coffee, Cookie, CupSoda } from "lucide-react";
import type { SweetHomeCategoryId, SweetHomeIconId } from "@/landing/demo/sweetHome";

const CHIP_TINT: Record<SweetHomeCategoryId, string> = {
  bebidas: "rgba(79,126,247,0.12)",
  reposteria: "hsl(38 92% 55% / 0.12)",
};

type CustomIconProps = { size: number };

function MugIcon({ size }: CustomIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 10h11v8a3 3 0 0 1-3 3H8a3 3 0 0 1-3-3v-8Z" />
      <path d="M16 11h2a2.5 2.5 0 0 1 0 5h-2" />
      <path d="M8 3v2.5M11 2v3.5M14 3v2.5" />
    </svg>
  );
}

function BrownieIcon({ size }: CustomIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="4" y="6" width="16" height="13" rx="2" />
      <path d="M4 11h16" />
      <path d="M9 14.5h.01M14.5 15.5h.01M11.5 17h.01" />
    </svg>
  );
}

function ConchaIcon({ size }: CustomIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3.5 17a8.5 8.5 0 0 1 17 0v1.5h-17V17Z" />
      <path d="M8 9.6V18.5M12 8.5v10M16 9.6V18.5" />
    </svg>
  );
}

function PanqueIcon({ size }: CustomIconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 11c0-2 1.8-4 4-4 .6-1.8 2.2-3 4-3s3.4 1.2 4 3c2.2 0 4 2 4 4a3 3 0 0 1-2 2.8V19a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1v-5.2A3 3 0 0 1 4 11Z" />
      <path d="M10 16v2M14 15v3" />
    </svg>
  );
}

const ICONS: Record<SweetHomeIconId, (props: CustomIconProps) => ReactNode> = {
  "latte-vainilla": ({ size }) => <CupSoda size={size} strokeWidth={1.5} />,
  americano: ({ size }) => <Coffee size={size} strokeWidth={1.5} />,
  chocolate: ({ size }) => <MugIcon size={size} />,
  cheesecake: ({ size }) => <CakeSlice size={size} strokeWidth={1.5} />,
  brownie: ({ size }) => <BrownieIcon size={size} />,
  galleta: ({ size }) => <Cookie size={size} strokeWidth={1.5} />,
  concha: ({ size }) => <ConchaIcon size={size} />,
  panque: ({ size }) => <PanqueIcon size={size} />,
};

export function ProductIcon({
  iconId,
  categoryId,
  size = 20,
}: {
  iconId: SweetHomeIconId;
  categoryId: SweetHomeCategoryId;
  size?: number;
}) {
  const chipStyle: CSSProperties = {
    width: size + 12,
    height: size + 12,
    borderRadius: 8,
    background: CHIP_TINT[categoryId],
    color: "var(--kova-tertiary)",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  };
  return (
    <span aria-hidden="true" style={chipStyle}>
      {ICONS[iconId]({ size })}
    </span>
  );
}
