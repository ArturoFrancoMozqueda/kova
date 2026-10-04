import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { copy } from "@/i18n/messages";
import ForgotPasswordView from "./ForgotPasswordView";

function renderView() {
  return render(<MemoryRouter><ForgotPasswordView /></MemoryRouter>);
}

function send(email = "owner@example.com") {
  fireEvent.change(screen.getByLabelText(copy.auth.email), { target: { value: email } });
  fireEvent.click(screen.getByRole("button", { name: copy.auth.forgotPasswordSubmit }));
}

function accepted() {
  return new Response(JSON.stringify({ message: "If that email exists, a reset link has been sent." }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ForgotPasswordView recovery", () => {
  it.each(["owner@example.com", "unknown@example.com"])("keeps accepted requests generic for %s", async (email) => {
    const fetchMock = vi.fn().mockImplementation(accepted);
    vi.stubGlobal("fetch", fetchMock);
    renderView();
    send(email);

    expect(await screen.findByRole("status")).toHaveTextContent(copy.auth.forgotPasswordSent);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/auth/password-reset/request", expect.objectContaining({
      method: "POST", body: JSON.stringify({ email }),
    }));
  });

  it.each([429, 500])("allows retry after HTTP %s without showing server details", async (status) => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response("Sensitive server details", { status }))
      .mockImplementationOnce(accepted);
    vi.stubGlobal("fetch", fetchMock);
    const { container } = renderView();
    send();

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.auth.forgotPasswordError);
    expect(screen.queryByText(copy.auth.forgotPasswordSent)).not.toBeInTheDocument();
    expect(screen.queryByText("Sensitive server details")).not.toBeInTheDocument();
    expect(screen.getByLabelText(copy.auth.email)).toHaveValue("owner@example.com");
    expect((await axe(container)).violations).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: copy.auth.forgotPasswordSubmit }));
    expect(await screen.findByRole("status")).toHaveTextContent(copy.auth.forgotPasswordSent);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from a network failure instead of promising a sent email", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    renderView();
    send();

    expect(await screen.findByRole("alert")).toHaveTextContent(copy.auth.forgotPasswordError);
    expect(screen.getByRole("button", { name: copy.auth.forgotPasswordSubmit })).toBeEnabled();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("keeps the submitted address fixed while the request is pending", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => new Promise<Response>((done) => { resolve = done; })));
    renderView();
    send();

    expect(screen.getByLabelText(copy.auth.email)).toBeDisabled();
    expect(screen.getByRole("button", { name: copy.auth.submitting })).toBeDisabled();
    resolve(accepted());
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(copy.auth.forgotPasswordSent));
  });
});
