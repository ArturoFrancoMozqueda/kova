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
        "flex shrink-0 items-center justify-center overflow-hidden rounded-kova-md",
        surface === "sidebar"
          ? "bg-white/5 shadow-sm ring-1 ring-inset ring-white/15"
          : "border border-kova-border bg-white",
      )}
      style={{ width: size, height: size }}
    >
      <img
        src={logoUrl ?? undefined}
        alt=""
        className="h-full w-full object-cover"
        onError={() => setFailedLogoUrl(logoUrl)}
      />
    </span>
  );
}
