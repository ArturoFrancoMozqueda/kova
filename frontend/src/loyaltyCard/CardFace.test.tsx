import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { CardFace, cardTextColor } from "./CardFace";
const luminance = (value: string) => {
  const c = [1, 3, 5]
    .map((i) => parseInt(value.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
};
it("keeps at least 4.5:1 contrast across the full gray range and brand colors", () => {
  const colors = [
    ...Array.from(
      { length: 256 },
      (_, v) => `#${v.toString(16).padStart(2, "0").repeat(3)}`,
    ),
    "#0F1117",
    "#DDCCAA",
    "#ff0000",
    "#00ff00",
    "#0000ff",
  ];
  for (const color of colors) {
    const a = luminance(color),
      b = luminance(cardTextColor(color));
    expect(
      (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
    ).toBeGreaterThanOrEqual(4.5);
  }
});
it("only renders an opted-in first party business logo and has a safe color fallback", () => {
  const view = render(
    <CardFace
      label="Tarjeta"
      appearance={{
        color: "url(bad)",
        use_business_logo: true,
        logo_url: "https://untrusted.example/logo.png",
      }}
    >
      Regla pendiente
    </CardFace>,
  );
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Tarjeta")).toHaveStyle({
    backgroundColor: "#0F1117",
  });
  view.rerender(
    <CardFace
      label="Tarjeta"
      appearance={{
        color: "#FFFFFF",
        use_business_logo: true,
        logo_url: "/api/v1/settings/receipt/logo/business?v=1",
      }}
    >
      Regla pendiente
    </CardFace>,
  );
  expect(screen.getByRole("img", { name: "Logo del negocio" })).toBeVisible();
});
