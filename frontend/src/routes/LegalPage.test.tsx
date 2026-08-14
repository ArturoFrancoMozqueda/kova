import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import LegalPage from "./LegalPage";

function renderLegal(variant: "terms" | "security") {
  return render(
    <MemoryRouter>
      <LegalPage variant={variant} />
    </MemoryRouter>,
  );
}

describe("commercial and security claims", () => {
  it("separates POS payment records and receipts from regulated payment and fiscal services", () => {
    renderLegal("terms");

    expect(screen.getByText(/no es una terminal bancaria ni procesa ese dinero/i)).toBeVisible();
    expect(screen.getByText(/no son facturas ni CFDI/i)).toBeVisible();
    expect(screen.getByText(/beta privada controlada/i)).toBeVisible();
  });

  it("does not present a real restore as already proven", () => {
    renderLegal("security");

    expect(screen.getByText(/simulacro completo con un respaldo real todavía es un gate operativo pendiente/i)).toBeVisible();
    expect(screen.getByText(/no ofrecemos un SLA formal/i)).toBeVisible();
    expect(screen.queryByText(/recibimos alerta inmediata/i)).not.toBeInTheDocument();
  });
});
