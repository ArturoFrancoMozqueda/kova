import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import LegalPage from "./LegalPage";

function renderLegal(variant: "terms" | "security" | "privacy") {
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
    expect(screen.getByText(/beta controlada con acompañamiento/i)).toBeVisible();
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

  it("preserves legacy agreements while disclosing monthly prices and recurring consent", () => {
    renderLegal("terms");

    expect(screen.getByText(/Esencial por \$399 MXN al mes o Gestión por \$699 MXN al mes, con impuestos incluidos/i)).toBeVisible();
    expect(screen.getByText(/Los acuerdos Standard anteriores de \$299 MXN al mes conservan/i)).toBeVisible();
    expect(screen.getByText(/Los cobros recurrentes requieren una autorización expresa e informada al contratar/i)).toBeVisible();
    expect(screen.getByText(/La prueba no se convierte en un cobro automático/i)).toBeVisible();
    expect(screen.getByText(/al menos cinco días naturales de anticipación/i)).toBeVisible();
  });

  it("separates renewal cancellation, account deletion and restoration of billing", () => {
    renderLegal("terms");

    expect(screen.getByText(/Cancelar la renovación no elimina la cuenta/i)).toBeVisible();
    expect(screen.getByText(/Cancelar esa solicitud no equivale a reactivar la renovación/i)).toBeVisible();
    expect(screen.getByText(/plazo reversible de al menos 30 días, que se extiende si el periodo ya pagado termina después/i)).toBeVisible();
    expect(screen.getByText(/hasta 7 días adicionales después de la purga/i)).toBeVisible();
    expect(screen.queryByText(/terminar la cuenta.*no paga/i)).not.toBeInTheDocument();
  });

  it("does not substitute continued use for express consent or waive mandatory rights", () => {
    renderLegal("terms");

    expect(screen.getByText(/El uso posterior del servicio no sustituye un consentimiento expreso/i)).toBeVisible();
    expect(screen.getByText(/No se exige renunciar a ellos para utilizar Kova/i)).toBeVisible();
    expect(screen.queryByText(/renunciando.*fuero/i)).not.toBeInTheDocument();
  });

  it("aligns the privacy trade name and retention with the account lifecycle", () => {
    renderLegal("privacy");

    expect(screen.getByText(/nombre comercial Kovasuite/i)).toBeVisible();
    expect(screen.getByText(/Los respaldos pueden conservar una copia hasta 7 días adicionales/i)).toBeVisible();
    expect(screen.getByText(/no sustituye los mecanismos ni los plazos legales para ejercer derechos/i)).toBeVisible();
    expect(screen.queryByText(/hasta 5 años/i)).not.toBeInTheDocument();
  });
});
