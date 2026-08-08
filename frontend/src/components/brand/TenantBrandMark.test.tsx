import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { TenantBrandMark } from "./TenantBrandMark";

const defaultProps = {
  size: 32,
  surface: "sidebar" as const,
  fallbackCircuitColor: "white",
};

describe("TenantBrandMark", () => {
  it("shows the Kova mark while the tenant has no logo", () => {
    const { container } = render(<TenantBrandMark {...defaultProps} logoUrl={null} />);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows the tenant logo when one is configured", () => {
    const { container } = render(
      <TenantBrandMark {...defaultProps} logoUrl="/api/v1/settings/receipt/logo/tenant-1?v=1" />,
    );

    const image = container.querySelector('img[src*="tenant-1"]');
    expect(image).toBeInTheDocument();
    expect(image).toHaveClass("object-cover");
    expect(image?.parentElement).not.toHaveClass("p-1", "bg-white");
    expect(container.querySelector("svg")).not.toBeInTheDocument();
  });

  it("falls back to Kova if the configured image cannot load", () => {
    const { container } = render(
      <TenantBrandMark {...defaultProps} logoUrl="/api/v1/settings/receipt/logo/broken" />,
    );

    fireEvent.error(container.querySelector("img") as HTMLImageElement);

    expect(container.querySelector("svg")).toBeInTheDocument();
    expect(container.querySelector("img")).not.toBeInTheDocument();
  });
});
