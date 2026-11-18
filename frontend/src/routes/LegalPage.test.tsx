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

  it("distinguishes verified logical restores from pending regional service recovery", () => {
    renderLegal("security");

    expect(screen.getByText(/han verificado la restauración lógica/i)).toBeVisible();
    expect(screen.getByText(/falta completar y medir la recuperación del servicio ante una falla regional/i)).toBeVisible();
    expect(screen.getByText(/no ofrecemos un SLA formal/i)).toBeVisible();
    expect(screen.queryByText(/recibimos alerta inmediata/i)).not.toBeInTheDocument();
  });

  it("describes the existing payment recovery without denying account portability", () => {
    renderLegal("terms");

    expect(screen.getByText(/como máximo 48 horas desde el primer intento fallido/i)).toBeVisible();
    expect(screen.getByText(/la exportación de datos y la solicitud de eliminación de la cuenta permanecen disponibles/i)).toBeVisible();
    expect(screen.queryByText(/180 días|mientras el adeudo permanezca pendiente/i)).not.toBeInTheDocument();
  });
});
