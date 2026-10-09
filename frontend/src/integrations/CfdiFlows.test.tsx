import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CfdiConnectionPanel } from "./CfdiConnectionPanel";
import { CfdiPreparationPanel } from "./CfdiPreparationPanel";
import { CfdiDocumentsPanel } from "./CfdiDocumentsPanel";
import { CfdiPanel } from "./CfdiPanel";
import {
  cancelCfdi,
  connectCfdi,
  downloadCfdi,
  getCfdiStatus,
  getManagedCfdiSetup,
  getInvoiceContext,
  issueCfdi,
  listCfdiDocuments,
  previewCfdi,
  reconcileCfdi,
  type CfdiDocument,
  type CfdiStatus,
  type InvoiceContext,
  type InvoicePreview,
} from "./cfdiApi";

vi.mock("./cfdiApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cfdiApi")>()),
  cancelCfdi: vi.fn(),
  connectCfdi: vi.fn(),
  downloadCfdi: vi.fn(),
  getCfdiStatus: vi.fn(),
  getManagedCfdiSetup: vi.fn(),
  getInvoiceContext: vi.fn(),
  issueCfdi: vi.fn(),
  listCfdiDocuments: vi.fn(),
  previewCfdi: vi.fn(),
  reconcileCfdi: vi.fn(),
  refreshCfdiConnection: vi.fn(),
}));
const identity = {
  rfc: "EKU9003173C9",
  legal_name: "Negocio",
  postal_code: "06000",
  tax_regime: "601",
};
const connection = {
  environment: "test" as const,
  organization_id: "org-1",
  connected: true,
  issuer_rfc: identity.rfc,
  production_ready: false,
  certificate_expires_at: null,
};
const status: CfdiStatus = {
  storage_available: true,
  provider: "facturapi",
  connections: [connection],
};
const context: InvoiceContext = {
  request_id: "request-1",
  order_id: "order-1",
  issuer: identity,
  recipient: {
    ...identity,
    legal_name: "Cliente",
    email: "client@example.com",
    cfdi_use: "G03",
  },
  total_amount: "116.00",
  discount_amount: "0.00",
  lines: [
    {
      order_item_id: "line-1",
      product_name: "Producto real",
      quantity: 1,
      unit_price_amount: "116.00",
      discount_amount: "0.00",
      tax_amount: "0.00",
      line_total_amount: "116.00",
    },
  ],
  payments: [{ method: "cash", amount: "116.00" }],
  suggested_payment_forms: ["01"],
};
const preview: InvoicePreview = {
  recipient_snapshot: context.recipient,
  request_id: context.request_id,
  order_id: context.order_id,
  environment: "test",
  subtotal_amount: "100.00",
  discount_amount: "0.00",
  tax_amount: "16.00",
  total_amount: "116.00",
  lines: [
    {
      order_item_id: "line-1",
      product_name: "Producto real",
      quantity: 1,
      product_key: "50181900",
      unit_key: "H87",
      tax_kind: "iva16",
      tax_included: true,
      unit_price_amount: "100.000000",
      gross_amount: "100.000000",
      discount_amount: "0.000000",
      tax_amount: "16.00",
      total_amount: "116.00",
    },
  ],
};
const document: CfdiDocument = {
  recipient_snapshot: context.recipient,
  id: "document-1",
  request_id: context.request_id,
  order_id: context.order_id,
  environment: "test",
  state: "issued",
  provider_id: "provider-1",
  uuid: "11111111-1111-4111-8111-111111111111",
  total_amount: "116.00",
  created_at: "2026-10-06T12:00:00Z",
  updated_at: "2026-10-06T12:00:00Z",
  last_error_code: null,
  cancellation_status: null,
  xml_available: true,
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getCfdiStatus).mockResolvedValue(status);
  vi.mocked(getManagedCfdiSetup).mockResolvedValue({
    available: true, state: "configured", issuer: identity,
    organization_created: true, test_connected: true, live_connected: false,
    production_ready: false, certificate_expires_at: null,
    last_error_code: null, manifest_url: null,
  });
  vi.mocked(listCfdiDocuments).mockResolvedValue([]);
  vi.mocked(getInvoiceContext).mockResolvedValue(context);
  vi.mocked(previewCfdi).mockImplementation(async (body) => ({
    ...preview,
    recipient_snapshot: body.recipient ?? context.recipient,
  }));
  vi.mocked(issueCfdi).mockResolvedValue(document);
});

describe("Conexión fiscal", () => {
  it("defaults to Test and clears an organization secret even on network failure", async () => {
    const onStatus = vi.fn();
    vi.mocked(connectCfdi).mockRejectedValue(
      new Error("No pudimos verificar la organización"),
    );
    render(
      <CfdiConnectionPanel
        status={status}
        environment="test"
        onEnvironment={vi.fn()}
        onStatus={onStatus}
        issuerRfc={identity.rfc}
      />,
    );
    expect(screen.getByLabelText("Ambiente fiscal")).toHaveValue("test");
    const secret = screen.getByLabelText("Llave de organización Test");
    expect(secret).toHaveAttribute("type", "password");
    fireEvent.change(secret, {
      target: { value: "sk_test_sensitive-example" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar conexión" }));
    expect(secret).toHaveValue("");
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "No pudimos verificar",
    );
    expect(connectCfdi).toHaveBeenCalledWith(
      "test",
      "sk_test_sensitive-example",
    );
    expect(onStatus).not.toHaveBeenCalled();
    expect(localStorage.getItem("api_key")).toBeNull();
  });
  it("updates public status after verifying connection and rejects issuer mismatch in the UI", async () => {
    const onStatus = vi.fn();
    vi.mocked(connectCfdi).mockResolvedValue(connection);
    render(
      <CfdiConnectionPanel
        status={{
          ...status,
          connections: [
            {
              ...connection,
              environment: "live",
              certificate_expires_at: "2099-01-01T00:00:00Z",
            },
          ],
        }}
        environment="live"
        onEnvironment={vi.fn()}
        onStatus={onStatus}
        issuerRfc="AAA010101AAA"
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "El RFC de la organización no coincide",
    );
    fireEvent.change(screen.getByLabelText("Llave de organización Live"), {
      target: { value: "sk_live_new-key" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Guardar conexión" }));
    await waitFor(() => expect(onStatus).toHaveBeenCalledWith(status));
    expect(getCfdiStatus).toHaveBeenCalled();
  });
  it("clears the key when switching fiscal environment", () => {
    const onEnvironment = vi.fn();
    render(
      <CfdiConnectionPanel
        status={status}
        environment="test"
        onEnvironment={onEnvironment}
        onStatus={vi.fn()}
      />,
    );
    const secret = screen.getByLabelText("Llave de organización Test");
    fireEvent.change(secret, { target: { value: "sk_test_private" } });
    fireEvent.change(screen.getByLabelText("Ambiente fiscal"), {
      target: { value: "live" },
    });
    expect(secret).toHaveValue("");
    expect(onEnvironment).toHaveBeenCalledWith("live");
    expect(connectCfdi).not.toHaveBeenCalled();
  });
  it("shows unavailable secure storage honestly and prevents credential submission", () => {
    render(
      <CfdiConnectionPanel
        status={{ ...status, storage_available: false }}
        environment="live"
        onEnvironment={vi.fn()}
        onStatus={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Llave de organización Live")).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Guardar conexión" }),
    ).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent(
      "configuración del servidor",
    );
  });
});

async function completePreparation() {
  await screen.findByText("Producto real · 1 unidades");
  fireEvent.change(screen.getByLabelText("Forma de pago SAT"), {
    target: { value: "01" },
  });
  fireEvent.change(screen.getByLabelText("Clave SAT del producto 1"), {
    target: { value: "50181900" },
  });
  fireEvent.change(screen.getByLabelText("Clave SAT de unidad 1"), {
    target: { value: "H87" },
  });
  fireEvent.change(screen.getByLabelText("Tratamiento fiscal 1"), {
    target: { value: "iva16" },
  });
  fireEvent.change(screen.getByLabelText("Impuesto en el precio 1"), {
    target: { value: "included" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Calcular vista previa fiscal" }),
  );
  await screen.findByRole("heading", { name: /Revisa antes de emitir/ });
}
function prepareProps() {
  return {
    requestId: "request-1",
    environment: "test" as const,
    ready: true,
    onDocument: vi.fn(),
    onBusy: vi.fn(),
  };
}

describe("Preparación y emisión", () => {
  it("requires explicit SAT classifications and review, then invalidates preview on edits", async () => {
    render(<CfdiPreparationPanel {...prepareProps()} />);
    await screen.findByText("Producto real · 1 unidades");
    expect(screen.getByLabelText("Tratamiento fiscal 1")).toHaveValue("");
    expect(
      screen.getByRole("button", { name: "Calcular vista previa fiscal" }),
    ).toBeDisabled();
    expect(
      screen.queryByRole("option", { name: /Tarjeta/ }),
    ).not.toBeInTheDocument();
    await completePreparation();
    expect(
      screen.getByRole("button", { name: "Emitir documento de prueba" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
    );
    expect(
      screen.getByRole("button", { name: "Emitir documento de prueba" }),
    ).toBeEnabled();
    fireEvent.change(screen.getByLabelText("Clave SAT de unidad 1"), {
      target: { value: "E48" },
    });
    expect(
      screen.queryByRole("button", { name: "Emitir documento de prueba" }),
    ).not.toBeInTheDocument();
    expect(issueCfdi).not.toHaveBeenCalled();
    expect(previewCfdi).toHaveBeenCalledWith({
      request_id: "request-1",
      recipient: context.recipient,
      environment: "test",
      payment_form: "01",
      lines: [
        {
          order_item_id: "line-1",
          product_key: "50181900",
          unit_key: "H87",
          tax_kind: "iva16",
          tax_included: true,
        },
      ],
    });
  });
  it("allows correcting the recipient before an attempt and invalidates review when details change", async () => {
    render(<CfdiPreparationPanel {...prepareProps()} />);
    await completePreparation();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
    );
    fireEvent.change(screen.getByLabelText("RFC del receptor"), {
      target: { value: "AAA010101AAA" },
    });
    fireEvent.change(screen.getByLabelText("Razón social del receptor"), {
      target: { value: "Cliente corregido" },
    });
    expect(
      screen.queryByRole("button", { name: "Emitir documento de prueba" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Calcular vista previa fiscal" }),
    );
    expect(
      await screen.findByText(/Receptor de esta emisión: Cliente corregido/),
    ).toHaveTextContent("AAA010101AAA");
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Emitir documento de prueba" }),
    );
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirmar envío al proveedor",
      }),
    );
    await waitFor(() =>
      expect(issueCfdi).toHaveBeenCalledWith(
        expect.objectContaining({
          recipient: expect.objectContaining({
            rfc: "AAA010101AAA",
            legal_name: "Cliente corregido",
          }),
        }),
        expect.any(String),
      ),
    );
    expect(context.recipient.rfc).toBe(identity.rfc);
  });
  it("retains the same idempotency key after unknown network outcome and requires explicit confirmation", async () => {
    const props = prepareProps();
    vi.mocked(issueCfdi)
      .mockRejectedValueOnce(
        new Error("Respuesta no confirmada, consulta el estado"),
      )
      .mockResolvedValueOnce(document);
    render(<CfdiPreparationPanel {...props} />);
    await completePreparation();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Emitir documento de prueba" }),
    );
    expect(issueCfdi).not.toHaveBeenCalled();
    const dialog = screen.getByRole("dialog");
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Confirmar envío al proveedor",
      }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Respuesta no confirmada",
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Confirmar envío al proveedor",
      }),
    );
    await waitFor(() =>
      expect(props.onDocument).toHaveBeenCalledWith(document),
    );
    expect(vi.mocked(issueCfdi).mock.calls[0]).toEqual(
      vi.mocked(issueCfdi).mock.calls[1],
    );
    expect(vi.mocked(issueCfdi).mock.calls[0][1]).toBeTruthy();
  });
  it("makes Live fiscal effect explicit in the confirmation before emission", async () => {
    vi.mocked(previewCfdi).mockResolvedValue({
      ...preview,
      environment: "live",
    });
    const props = prepareProps();
    render(<CfdiPreparationPanel {...props} environment="live" />);
    await completePreparation();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Emitir CFDI Live" }));
    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Confirmar emisión fiscal Live",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("timbrado fiscal");
    expect(issueCfdi).not.toHaveBeenCalled();
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Confirmar envío al proveedor",
      }),
    );
    await waitFor(() =>
      expect(issueCfdi).toHaveBeenCalledWith(
        expect.objectContaining({ environment: "live" }),
        expect.any(String),
      ),
    );
  });
  it("allows preview before connection but prevents issuance", async () => {
    render(<CfdiPreparationPanel {...prepareProps()} ready={false} />);
    await completePreparation();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
    );
    expect(
      screen.getByRole("button", { name: "Emitir documento de prueba" }),
    ).toBeDisabled();
    expect(issueCfdi).not.toHaveBeenCalled();
  });
  it("blocks an inconsistent preview total and does not offer issuance", async () => {
    vi.mocked(previewCfdi).mockResolvedValue({
      ...preview,
      total_amount: "117.00",
    });
    render(<CfdiPreparationPanel {...prepareProps()} />);
    await screen.findByText("Producto real · 1 unidades");
    for (const [label, value] of [
      ["Forma de pago SAT", "01"],
      ["Clave SAT del producto 1", "50181900"],
      ["Clave SAT de unidad 1", "H87"],
      ["Tratamiento fiscal 1", "iva16"],
      ["Impuesto en el precio 1", "included"],
    ])
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    fireEvent.click(
      screen.getByRole("button", { name: "Calcular vista previa fiscal" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "no coincide con el total cobrado",
    );
    expect(
      screen.queryByRole("button", { name: "Emitir documento de prueba" }),
    ).not.toBeInTheDocument();
  });
  it("does not allow included pricing when the sale charged an additional tax", async () => {
    vi.mocked(getInvoiceContext).mockResolvedValue({
      ...context,
      lines: [{ ...context.lines[0], tax_amount: "16.00" }],
    });
    render(<CfdiPreparationPanel {...prepareProps()} />);
    await screen.findByText("Producto real · 1 unidades");
    expect(
      screen.queryByRole("option", { name: "Incluido en el importe cobrado" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Adicional: ya cobrado en la venta" }),
    ).toBeInTheDocument();
  });
});

describe("Documentos y cancelación", () => {
  it("reconciles unknown provider state without issuing again", async () => {
    vi.mocked(reconcileCfdi).mockResolvedValue(document);
    const onDocument = vi.fn();
    render(
      <CfdiDocumentsPanel
        documents={[
          { ...document, state: "unknown", xml_available: false, uuid: null },
        ]}
        onDocument={onDocument}
        onRefresh={vi.fn()}
      />,
    );
    expect(screen.getByText(/Resultado desconocido/)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Solicitar cancelación" }),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Consultar estado con proveedor" }),
    );
    await waitFor(() => expect(onDocument).toHaveBeenCalledWith(document));
    expect(issueCfdi).not.toHaveBeenCalled();
  });
  it("downloads private XML through its authenticated helper", async () => {
    vi.mocked(downloadCfdi).mockResolvedValue();
    render(
      <CfdiDocumentsPanel
        documents={[document]}
        onDocument={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    expect(
      screen.getByText("Test · Sin validez fiscal · $116.00"),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Descargar XML" }));
    await waitFor(() =>
      expect(downloadCfdi).toHaveBeenCalledWith(document.id, "xml", "test"),
    );
  });
  it("requires replacement UUID for motive01 and reports pending cancellation without inventing SAT confirmation", async () => {
    vi.mocked(cancelCfdi).mockResolvedValue({
      ...document,
      state: "cancel_pending",
      cancellation_status: "pending",
    });
    const onDocument = vi.fn();
    render(
      <CfdiDocumentsPanel
        documents={[{ ...document, environment: "live" }]}
        onDocument={onDocument}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Solicitar cancelación" }),
    );
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText(/CFDI real/)).toBeInTheDocument();
    fireEvent.change(
      within(dialog).getByLabelText("Motivo SAT de cancelación"),
      { target: { value: "01" } },
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Confirmo el motivo/ }),
    );
    expect(
      within(dialog).getByRole("button", {
        name: "Enviar solicitud de cancelación",
      }),
    ).toBeDisabled();
    fireEvent.change(
      within(dialog).getByLabelText("UUID de la factura sustituta"),
      { target: { value: "22222222-2222-4222-8222-222222222222" } },
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Confirmo el motivo/ }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Enviar solicitud de cancelación",
      }),
    );
    await waitFor(() =>
      expect(onDocument).toHaveBeenCalledWith(
        expect.objectContaining({ state: "cancel_pending" }),
      ),
    );
    expect(cancelCfdi).toHaveBeenCalledWith(
      document.id,
      {
        motive: "01",
        substitution_uuid: "22222222-2222-4222-8222-222222222222",
      },
      expect.any(String),
    );
  });
  it("retries cancellation with the same key and excludes substitution UUID for motive02", async () => {
    vi.mocked(cancelCfdi)
      .mockRejectedValueOnce(new Error("Sin respuesta"))
      .mockResolvedValueOnce({ ...document, state: "cancel_pending" });
    render(
      <CfdiDocumentsPanel
        documents={[document]}
        onDocument={vi.fn()}
        onRefresh={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Solicitar cancelación" }),
    );
    const dialog = screen.getByRole("dialog");
    fireEvent.change(
      within(dialog).getByLabelText("Motivo SAT de cancelación"),
      { target: { value: "02" } },
    );
    fireEvent.click(
      within(dialog).getByRole("checkbox", { name: /Confirmo el motivo/ }),
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Enviar solicitud de cancelación",
      }),
    );
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Sin respuesta",
    );
    fireEvent.click(
      within(dialog).getByRole("button", {
        name: "Enviar solicitud de cancelación",
      }),
    );
    await waitFor(() => expect(cancelCfdi).toHaveBeenCalledTimes(2));
    expect(vi.mocked(cancelCfdi).mock.calls[0]).toEqual(
      vi.mocked(cancelCfdi).mock.calls[1],
    );
    expect(vi.mocked(cancelCfdi).mock.calls[0][1]).toEqual({ motive: "02" });
  });
});

describe("Ambientes y protección contra emisión duplicada", () => {
  it.each([null, "AAA010101AAA"])(
    "permits a Test organization with missing/demo RFC %s without requiring fiscal Live readiness",
    async (testRfc) => {
      vi.mocked(getCfdiStatus).mockResolvedValue({
        ...status,
        connections: [{ ...connection, issuer_rfc: testRfc }],
      });
      render(
        <CfdiPanel
          requests={[
            {
              id: context.request_id,
              order_id: context.order_id,
              recipient_snapshot: context.recipient,
              total_amount: "116.00",
              status: "pending_provider",
              fiscal_status: "not_issued",
              created_at: document.created_at,
            },
          ]}
          issuerRfc={identity.rfc}
          onConnectionLabel={vi.fn()}
        />,
      );
      expect(await screen.findByLabelText("Ambiente fiscal")).toHaveValue(
        "test",
      );
      fireEvent.click(screen.getByRole("button", { name: "Preparar emisión" }));
      await completePreparation();
      fireEvent.click(
        screen.getByRole("checkbox", { name: /Revisé el receptor/ }),
      );
      expect(
        screen.getByRole("button", { name: "Emitir documento de prueba" }),
      ).toBeEnabled();
    },
  );
  it("defaults to Test and disables preparation for an existing active document", async () => {
    vi.mocked(listCfdiDocuments).mockResolvedValue([
      { ...document, state: "unknown" },
    ]);
    render(
      <CfdiPanel
        requests={[
          {
            id: context.request_id,
            order_id: context.order_id,
            recipient_snapshot: context.recipient,
            total_amount: "116.00",
            status: "pending_provider",
            fiscal_status: "not_issued",
            created_at: document.created_at,
          },
        ]}
        issuerRfc={identity.rfc}
        onConnectionLabel={vi.fn()}
      />,
    );
    expect(await screen.findByLabelText("Ambiente fiscal")).toHaveValue("test");
    expect(
      screen.getByRole("button", { name: "Preparar emisión" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Consultar estado con proveedor" }),
    ).toBeEnabled();
  });
});
