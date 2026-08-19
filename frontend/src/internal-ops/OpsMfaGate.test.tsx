import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import OpsMfaGate from "./OpsMfaGate";

const getOpsMfaStatus = vi.fn();
const setupOpsMfa = vi.fn();
const confirmOpsMfa = vi.fn();
const verifyOpsMfa = vi.fn();

vi.mock("./api", () => ({
  getOpsMfaStatus: () => getOpsMfaStatus(),
  setupOpsMfa: (password: string, enrollmentKey: string) => setupOpsMfa(password, enrollmentKey),
  confirmOpsMfa: (password: string, enrollmentKey: string, code: string) =>
    confirmOpsMfa(password, enrollmentKey, code),
  verifyOpsMfa: (code: string) => verifyOpsMfa(code),
}));

describe("OpsMfaGate", () => {
  beforeEach(() => {
    getOpsMfaStatus.mockReset();
    setupOpsMfa.mockReset();
    confirmOpsMfa.mockReset();
    verifyOpsMfa.mockReset();
  });

  it("enrolls with password, QR and a confirmed TOTP", async () => {
    getOpsMfaStatus.mockResolvedValue({ enrolled: false, step_up_valid: false, recovery_codes_remaining: 0 });
    setupOpsMfa.mockResolvedValue({
      secret: "BASE32SECRET",
      qr_png_data_url: "data:image/png;base64,AAAA",
    });
    confirmOpsMfa.mockResolvedValue({ recovery_codes: ["KOVA-AAAAA-BBBBB"], step_up_valid: true });
    const onVerified = vi.fn();
    render(<OpsMfaGate onVerified={onVerified} />);

    const password = await screen.findByLabelText("Confirma tu contraseña");
    fireEvent.change(password, { target: { value: "correct-password" } });
    fireEvent.change(screen.getByLabelText("Clave privada de enrolamiento"), {
      target: { value: "private-enrollment-key-with-32-characters" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Configurar MFA" }));

    expect(await screen.findByAltText("Código QR para configurar Kova Ops")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Código de 6 dígitos"), { target: { value: "123456" } });
    fireEvent.change(screen.getByLabelText("Confirma otra vez tu contraseña"), {
      target: { value: "correct-password" },
    });
    fireEvent.change(screen.getByLabelText("Confirma la clave privada de enrolamiento"), {
      target: { value: "private-enrollment-key-with-32-characters" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Activar y continuar" }));

    expect(await screen.findByText("KOVA-AAAAA-BBBBB")).toBeInTheDocument();
    expect(setupOpsMfa).toHaveBeenCalledWith(
      "correct-password",
      "private-enrollment-key-with-32-characters",
    );
    expect(confirmOpsMfa).toHaveBeenCalledWith(
      "correct-password",
      "private-enrollment-key-with-32-characters",
      "123456",
    );
    fireEvent.click(screen.getByRole("button", { name: "Ya los guardé" }));
    expect(onVerified).toHaveBeenCalledOnce();
  });

  it("accepts a TOTP or one-time recovery code for step-up", async () => {
    getOpsMfaStatus.mockResolvedValue({ enrolled: true, step_up_valid: false, recovery_codes_remaining: 9 });
    verifyOpsMfa.mockResolvedValue({ step_up_valid: true, used_recovery_code: true });
    const onVerified = vi.fn();
    render(<OpsMfaGate onVerified={onVerified} />);

    const code = await screen.findByLabelText("Código de autenticación");
    fireEvent.change(code, { target: { value: "KOVA-AAAAA-BBBBB" } });
    fireEvent.submit(code.closest("form")!);

    await waitFor(() => expect(onVerified).toHaveBeenCalledOnce());
    expect(verifyOpsMfa).toHaveBeenCalledWith("KOVA-AAAAA-BBBBB");
  });
});
