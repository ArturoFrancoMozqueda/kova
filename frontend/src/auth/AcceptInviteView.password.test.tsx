import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import AcceptInviteView from "./AcceptInviteView";

afterEach(() => { vi.unstubAllGlobals(); });

function renderInvite(acceptStatus = 200) {
  const fetchMock = vi.fn((input: RequestInfo | URL) => {
    const preview = input.toString().includes("/preview");
    return Promise.resolve(new Response(JSON.stringify(preview ? {
      email: "cashier@example.com", role: "cashier", tenant_name: "Byte limit", requires_password: true,
    } : { detail: [{ type: "password_too_long" }] }), {
      status: preview ? 200 : acceptStatus, headers: { "content-type": "application/json" },
    }));
  });
  vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={["/invite?token=invite-token"]}><AcceptInviteView /></MemoryRouter>);
  return fetchMock;
}

it("blocks oversized accented passwords and accepts the corrected password", async () => {
  const fetchMock = renderInvite();
  const input = await screen.findByLabelText(/Nueva contraseña/i);
  const password = "A1" + "ñ".repeat(36);
  fireEvent.change(input, { target: { value: password } });
  fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: password } });
  expect(screen.getByText(/La contraseña es demasiado larga/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Aceptar y continuar/i })).toBeDisabled();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  fireEvent.change(input, { target: { value: "Abc12345" } });
  fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "Abc12345" } });
  fireEvent.click(screen.getByRole("button", { name: /Aceptar y continuar/i }));
  expect(await screen.findByText(/Tu acceso se activó/i)).toBeInTheDocument();
});

it("keeps the invitation form available after a server byte-limit error", async () => {
  renderInvite(422);
  fireEvent.change(await screen.findByLabelText(/Nueva contraseña/i), { target: { value: "Abc12345" } });
  fireEvent.change(screen.getByLabelText(/Confirma la contraseña/i), { target: { value: "Abc12345" } });
  fireEvent.click(screen.getByRole("button", { name: /Aceptar y continuar/i }));
  expect(await screen.findByText(/La contraseña es demasiado larga/i)).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Aceptar y continuar/i })).toBeEnabled();
});
