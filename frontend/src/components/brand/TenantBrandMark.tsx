import { useState } from "react";

import { cn } from "@/lib/utils";

import { LogoMark } from "./Logo";

type TenantBrandMarkProps = {
  logoUrl: string | null;
  size: number;
  surface: "sidebar" | "header";
  fallbackCircuitColor: string;
};

export function TenantBrandMark({
  logoUrl,
  size,
  surface,
  fallbackCircuitColor,
}: TenantBrandMarkProps) {
  const [failedLogoUrl, setFailedLogoUrl] = useState<string | null>(null);
  const showTenantLogo = Boolean(logoUrl && logoUrl !== failedLogoUrl);

  if (!showTenantLogo) {
    return <LogoMark size={size} circuitColor={fallbackCircuitColor} />;
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-kova-sm bg-white",
        surface === "sidebar" ? "p-1 shadow-sm" : "border border-kova-border p-0.5",
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={logoUrl ?? undefined}
        alt=""
        className="h-full w-full object-contain"
        onError={() => setFailedLogoUrl(logoUrl)}
      />
    </span>
  );
}
