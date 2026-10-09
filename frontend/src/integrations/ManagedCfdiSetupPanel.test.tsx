import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ManagedCfdiSetupPanel } from "./ManagedCfdiSetupPanel";
import {
  getManagedCfdiSetup,
  ManagedCfdiError,
  refreshManagedCfdiSetup,
  startManagedCfdiSetup,
  uploadCfdiCertificate,
  type ManagedCfdiSetup,
} from "./cfdiApi";

vi.mock("./cfdiApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./cfdiApi")>()),
  getManagedCfdiSetup: vi.fn(),
  refreshManagedCfdiSetup: vi.fn(),
  startManagedCfdiSetup: vi.fn(),
  uploadCfdiCertificate: vi.fn(),
}));
const issuer = { rfc: "EKU9003173C9", legal_name: "Negocio", postal_code: "06000", tax_regime: "601" };
const initial: ManagedCfdiSetup = {
  available: true, state: "not_started", issuer: null,
  organization_created: false, test_connected: false, live_connected: false,
  production_ready: false, certificate_expires_at: null,
  last_error_code: null, manifest_url: null,
};
const configured: ManagedCfdiSetup = {
  ...initial, state: "configured", issuer, organization_created: true,
  test_connected: true, live_connected: true,
  manifest_url: "https://www.facturapi.io/embedded/manifiesto",
};
function props() {
  return { issuer, environment: "test" as const, onEnvironment: vi.fn(), onChange: vi.fn().mockResolvedValue(undefined), onBusy: vi.fn() };
}
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getManagedCfdiSetup).mockResolvedValue(initial);
  vi.mocked(startManagedCfdiSetup).mockResolvedValue(configured);
  vi.mocked(refreshManagedCfdiSetup).mockResolvedValue(configured);
  vi.mocked(uploadCfdiCertificate).mockResolvedValue(configured);
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function uploadFiles() {
  const cer = new File(["synthetic certificate"], "csd.cer");
  const key = new File(["synthetic key"], "csd.key");
  fireEvent.change(screen.getByLabelText("Certificado CSD (.cer)"), { target: { files: [cer] } });
  fireEvent.change(screen.getByLabelText("Llave privada CSD (.key)"), { target: { files: [key] } });
  fireEvent.change(screen.getByLabelText("Contraseña del CSD"), { target: { value: "synthetic-password" } });
  return { cer, key };
}
describe("Activación fiscal administrada", () => {
  it("creates the connection from the saved identity without account or API key fields", async () => {
    const options = props();
    render(<ManagedCfdiSetupPanel {...options} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Activar facturación" })).toBeEnabled());
    expect(screen.queryByLabelText(/Llave de organización/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Crea tu cuenta/)).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña del CSD")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Activar facturación" }));
    await screen.findByLabelText("Contraseña del CSD");
    expect(startManagedCfdiSetup).toHaveBeenCalledWith(issuer);
    expect(options.onChange).toHaveBeenCalledOnce();
    expect(options.onBusy.mock.calls).toEqual([[true], [false]]);
    expect(screen.getByText("4. Emisión Live · Pendiente")).toBeInTheDocument();
  });
  it("requires a saved issuer and server configuration before activation", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue({ ...initial, available: false });
    render(<ManagedCfdiSetupPanel {...props()} issuer={undefined} />);
    await screen.findByText(/necesita configuración por parte de Kova/);
    expect(screen.getByRole("button", { name: "Activar facturación" })).toBeDisabled();
    expect(screen.getByText(/Guarda los datos fiscales/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado de activación" }));
    await waitFor(() => expect(getManagedCfdiSetup).toHaveBeenCalledTimes(2));
    expect(startManagedCfdiSetup).not.toHaveBeenCalled();
  });
  it("does not recreate a legacy connection or ask the owner for provider keys", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue({ ...initial, state: "legacy", test_connected: true });
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByText(/conserva su conexión fiscal existente/);
    expect(screen.queryByRole("button", { name: "Activar facturación" })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña del CSD")).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Llave de organización/)).not.toBeInTheDocument();
  });
  it.each(["creating", "unknown"] as const)("requires reconciliation for %s instead of creating another organization", async (state) => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue({ ...initial, state });
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByText(/sin duplicarla/);
    expect(screen.getByRole("button", { name: "Activar facturación" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado de activación" }));
    await waitFor(() => expect(refreshManagedCfdiSetup).toHaveBeenCalledOnce());
    expect(startManagedCfdiSetup).not.toHaveBeenCalled();
  });
  it("clears CSD password and selected files immediately, including a failed upload", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue(configured);
    const pending = deferred<ManagedCfdiSetup>();
    vi.mocked(uploadCfdiCertificate).mockReturnValue(pending.promise);
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByLabelText("Contraseña del CSD");
    const { cer, key } = uploadFiles();
    const reset = vi.spyOn(HTMLFormElement.prototype, "reset");
    fireEvent.submit(screen.getByRole("button", { name: "Enviar CSD" }).closest("form")!);
    expect(uploadCfdiCertificate).toHaveBeenCalledWith(cer, key, "synthetic-password");
    expect(reset).toHaveBeenCalledOnce();
    expect(screen.getByLabelText("Contraseña del CSD")).toHaveValue("");
    await act(async () => pending.reject(new Error("synthetic-password sensitive upstream body")));
    expect(screen.getByRole("alert")).toHaveTextContent("No pudimos confirmar");
    expect(screen.queryByText(/sensitive upstream/)).not.toBeInTheDocument();
    expect(localStorage.length).toBe(0);
    reset.mockRestore();
  });
  it("rejects incorrect CSD file extensions before uploading and clears the password", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue(configured);
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByLabelText("Contraseña del CSD");
    uploadFiles();
    fireEvent.change(screen.getByLabelText("Certificado CSD (.cer)"), { target: { files: [new File(["wrong"], "certificate.pem")] } });
    fireEvent.submit(screen.getByRole("button", { name: "Enviar CSD" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("Selecciona el certificado .cer");
    expect(uploadCfdiCertificate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Contraseña del CSD")).toHaveValue("");
  });
  it.each([
    "No se pudo abrir el .key. Revisa el archivo y su contraseña.",
    "El certificado CSD está vencido. Carga uno vigente.",
    "El RFC del certificado debe coincidir con el RFC del negocio.",
  ])("explains the public CSD validation failure: %s", async (message) => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue(configured);
    vi.mocked(uploadCfdiCertificate).mockRejectedValue(new ManagedCfdiError(message));
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByLabelText("Contraseña del CSD");
    uploadFiles();
    fireEvent.submit(screen.getByRole("button", { name: "Enviar CSD" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByLabelText("Contraseña del CSD")).toHaveValue("");
    expect(screen.getByText("4. Emisión Live · Pendiente")).toBeInTheDocument();
  });
  it("rejects oversized files before network upload and clears their selection", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue(configured);
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByLabelText("Contraseña del CSD");
    uploadFiles();
    fireEvent.change(screen.getByLabelText("Certificado CSD (.cer)"), { target: { files: [new File([new Uint8Array(64 * 1024 + 1)], "csd.cer")] } });
    fireEvent.submit(screen.getByRole("button", { name: "Enviar CSD" }).closest("form")!);
    expect(screen.getByRole("alert")).toHaveTextContent("máximo 64 KB");
    expect(uploadCfdiCertificate).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Contraseña del CSD")).toHaveValue("");
  });
  it("blocks CSD uploads and readiness when current issuer differs from setup", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue({ ...configured, production_ready: true });
    render(<ManagedCfdiSetupPanel {...props()} issuer={{ ...issuer, rfc: "AAA010101AAA" }} />);
    await screen.findByLabelText("Contraseña del CSD");
    expect(screen.getByRole("alert")).toHaveTextContent("no coincide");
    expect(screen.getByRole("button", { name: "Enviar CSD" })).toBeDisabled();
    expect(screen.getByText("4. Emisión Live · Pendiente")).toBeInTheDocument();
  });
  it("can retry a failed initial read without starting another organization", async () => {
    vi.mocked(getManagedCfdiSetup).mockRejectedValueOnce(new Error("private body")).mockResolvedValueOnce(configured);
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByRole("alert");
    expect(screen.queryByText(/private body/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado de activación" }));
    await screen.findByLabelText("Contraseña del CSD");
    expect(getManagedCfdiSetup).toHaveBeenCalledTimes(2);
    expect(refreshManagedCfdiSetup).not.toHaveBeenCalled();
    expect(startManagedCfdiSetup).not.toHaveBeenCalled();
  });
  it("does not report Live readiness from connectivity or upload alone", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue(configured);
    render(<ManagedCfdiSetupPanel {...props()} environment="live" />);
    await screen.findByLabelText("Contraseña del CSD");
    uploadFiles();
    fireEvent.submit(screen.getByRole("button", { name: "Enviar CSD" }).closest("form")!);
    await screen.findByText(/Certificados enviados/);
    expect(screen.getByText("4. Emisión Live · Pendiente")).toBeInTheDocument();
    vi.mocked(refreshManagedCfdiSetup).mockResolvedValue({ ...configured, production_ready: true });
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado de activación" }));
    await screen.findByText("4. Emisión Live · Lista");
  });
  it("opens authorization only after an explicit click and never trusts an alternate URL", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue(configured);
    render(<ManagedCfdiSetupPanel {...props()} />);
    const open = await screen.findByRole("button", { name: "Revisar autorización fiscal" });
    expect(screen.queryByTitle("Manifiesto de autorización fiscal")).not.toBeInTheDocument();
    fireEvent.click(open);
    expect(screen.getByTitle("Manifiesto de autorización fiscal")).toHaveAttribute("src", "https://www.facturapi.io/embedded/manifiesto");
    expect(screen.getByTitle("Manifiesto de autorización fiscal")).toHaveAttribute("sandbox", "allow-scripts allow-forms allow-same-origin allow-popups allow-downloads");
    fireEvent.click(screen.getByRole("button", { name: "Cerrar autorización" }));
    expect(screen.queryByTitle("Manifiesto de autorización fiscal")).not.toBeInTheDocument();
    expect(refreshManagedCfdiSetup).not.toHaveBeenCalled();
    expect(screen.getByText("4. Emisión Live · Pendiente")).toBeInTheDocument();
  });
  it("does not embed an unexpected provider URL", async () => {
    vi.mocked(getManagedCfdiSetup).mockResolvedValue({ ...configured, manifest_url: "https://attacker.invalid" as ManagedCfdiSetup["manifest_url"] });
    render(<ManagedCfdiSetupPanel {...props()} />);
    await screen.findByLabelText("Contraseña del CSD");
    expect(screen.queryByRole("button", { name: "Revisar autorización fiscal" })).not.toBeInTheDocument();
  });
  it("prevents overlapping mutations even when submitted again before re-render", async () => {
    const pending = deferred<ManagedCfdiSetup>();
    vi.mocked(startManagedCfdiSetup).mockReturnValue(pending.promise);
    render(<ManagedCfdiSetupPanel {...props()} />);
    const button = screen.getByRole("button", { name: "Activar facturación" });
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);
    fireEvent.click(button);
    expect(startManagedCfdiSetup).toHaveBeenCalledOnce();
    expect(screen.getByRole("combobox", { name: "Ambiente fiscal" })).toBeDisabled();
    await act(async () => pending.resolve(configured));
  });
  it("ignores a completed mutation after unmount", async () => {
    const pending = deferred<ManagedCfdiSetup>();
    vi.mocked(startManagedCfdiSetup).mockReturnValue(pending.promise);
    const options = props();
    const view = render(<ManagedCfdiSetupPanel {...options} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Activar facturación" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Activar facturación" }));
    view.unmount();
    await act(async () => pending.resolve(configured));
    expect(options.onChange).not.toHaveBeenCalled();
  });
  it("does not let an old initial read overwrite a newer retry", async () => {
    const initialRead = deferred<ManagedCfdiSetup>();
    vi.mocked(getManagedCfdiSetup).mockReturnValueOnce(initialRead.promise).mockResolvedValueOnce(configured);
    render(<ManagedCfdiSetupPanel {...props()} />);
    fireEvent.click(screen.getByRole("button", { name: "Consultar estado de activación" }));
    await screen.findByLabelText("Contraseña del CSD");
    await act(async () => initialRead.resolve(initial));
    expect(screen.getByLabelText("Contraseña del CSD")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Activar facturación" })).not.toBeInTheDocument();
  });
});
