import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
import SettingsView from "./SettingsView";
import * as api from "./api";

const auth = vi.hoisted(() => ({ role: "owner", tenantId: "tenant-1", fiscalEnabled: false, refresh: vi.fn() }));
vi.mock("@/auth/useAuth", () => ({ useAuth: () => ({
  state: { status: "authenticated", tenantId: auth.tenantId, tenantName: "Negocio",
    tenantLogoUrl: null, featureFlags: { fiscal_global_drafts: auth.fiscalEnabled }, user: { role: auth.role } },
  refresh: auth.refresh, setTenantLogoUrl: vi.fn(),
}) }));
vi.mock("@/branches/BranchesSettings", () => ({ BranchesSettings: () => <div>Panel de sucursales independiente</div> }));
vi.mock("@/fiscal/FiscalGlobalDraftsPanel", () => ({ FiscalGlobalDraftsPanel: () => <div>Panel fiscal independiente</div> }));
vi.mock("./api", () => ({
  getBusinessProfile: vi.fn(), getReceiptSettings: vi.fn(), listEmployees: vi.fn(),
  listInvitations: vi.fn(), getAccountDeletionStatus: vi.fn(), saveBusinessProfile: vi.fn(),
  saveReceiptSettings: vi.fn(), inviteEmployee: vi.fn(), updateEmployeeRole: vi.fn(),
  deactivateEmployee: vi.fn(), resendInvitation: vi.fn(), revokeInvitation: vi.fn(),
  deleteReceiptLogo: vi.fn(), uploadReceiptLogo: vi.fn(), downloadAccountExport: vi.fn(),
  scheduleAccountDeletion: vi.fn(), cancelAccountDeletion: vi.fn(),
}));

function renderSettings(path = "/settings/business-profile") {
  return render(<MemoryRouter initialEntries={[path]}><ToastProvider><SettingsView /></ToastProvider></MemoryRouter>);
}
function BranchNavigation() {
  const navigate = useNavigate();
  return <button onClick={() => navigate("/settings/branches")}>Ir a sucursales</button>;
}
function renderNavigableSettings() {
  return render(<MemoryRouter initialEntries={["/settings/business-profile"]}><BranchNavigation /><ToastProvider><SettingsView /></ToastProvider></MemoryRouter>);
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("SettingsView safe loading and action recovery", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    auth.role = "owner";
    auth.tenantId = "tenant-1";
    auth.fiscalEnabled = false;
    vi.mocked(api.getBusinessProfile).mockResolvedValue({ tenant_id: "tenant-1", public_name: "Negocio",
      support_email: "contacto@example.com", support_phone: null, timezone: "America/Tijuana", locale: "es-MX", currency: "MXN" });
    vi.mocked(api.getReceiptSettings).mockResolvedValue({ tenant_id: "tenant-1", receipt_business_name: "Negocio",
      footer: "Gracias", tax_contact_text: null, logo_url: null, paper_width_mm: 58 });
    vi.mocked(api.listEmployees).mockResolvedValue([]);
    vi.mocked(api.listInvitations).mockResolvedValue([]);
    vi.mocked(api.getAccountDeletionStatus).mockResolvedValue({ status: "none", requested_at: null, purge_after: null });
  });

  it.each(["branches", "fiscal"])("loads independent %s without unrelated profile, receipt or employee requests", async (section) => {
    auth.fiscalEnabled = true;
    vi.mocked(api.getBusinessProfile).mockRejectedValue(new Error("Profile unavailable"));
    vi.mocked(api.getReceiptSettings).mockRejectedValue(new Error("Receipt unavailable"));
    vi.mocked(api.listEmployees).mockRejectedValue(new Error("Employees unavailable"));
    renderSettings(`/settings/${section}`);
    expect(await screen.findByText(section === "branches" ? "Panel de sucursales independiente" : "Panel fiscal independiente")).toBeVisible();
    expect(api.getBusinessProfile).not.toHaveBeenCalled();
    expect(api.getReceiptSettings).not.toHaveBeenCalled();
    expect(api.listEmployees).not.toHaveBeenCalled();
    expect(api.listInvitations).not.toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("ignores an old settings load after navigating to an independent section", async () => {
    const profile = deferred<api.BusinessProfile>();
    vi.mocked(api.getBusinessProfile).mockReturnValueOnce(profile.promise);
    renderNavigableSettings();
    await waitFor(() => expect(api.getBusinessProfile).toHaveBeenCalledOnce());
    fireEvent.click(screen.getByRole("button", { name: "Ir a sucursales" }));
    expect(await screen.findByText("Panel de sucursales independiente")).toBeVisible();
    await act(async () => profile.resolve({ tenant_id: "tenant-1", public_name: "Respuesta anterior",
      support_email: null, support_phone: null, timezone: "America/Tijuana", locale: "es-MX", currency: "MXN" }));
    expect(screen.getByText("Panel de sucursales independiente")).toBeVisible();
    expect(api.getBusinessProfile).toHaveBeenCalledOnce();
  });

  it("does not launch a stale loader when a save finishes after navigating to branches", async () => {
    const save = deferred<api.BusinessProfile>();
    vi.mocked(api.saveBusinessProfile).mockReturnValueOnce(save.promise);
    renderNavigableSettings();
    fireEvent.click(await screen.findByRole("button", { name: copy.settings.saveBusiness }));
    fireEvent.click(screen.getByRole("button", { name: "Ir a sucursales" }));
    expect(await screen.findByText("Panel de sucursales independiente")).toBeVisible();
    await act(async () => save.resolve({ tenant_id: "tenant-1", public_name: "Negocio",
      support_email: null, support_phone: null, timezone: "America/Tijuana", locale: "es-MX", currency: "MXN" }));
    expect(screen.getByText("Panel de sucursales independiente")).toBeVisible();
    expect(api.getBusinessProfile).toHaveBeenCalledOnce();
  });

  it("requires confirmed settings again when returning from an independent section", async () => {
    renderNavigableSettings();
    expect(await screen.findByLabelText(copy.settings.publicName)).toHaveValue("Negocio");
    fireEvent.click(screen.getByRole("button", { name: "Ir a sucursales" }));
    expect(await screen.findByText("Panel de sucursales independiente")).toBeVisible();
    vi.mocked(api.getBusinessProfile).mockRejectedValueOnce(new Error("Profile unavailable"));
    fireEvent.click(screen.getByRole("link", { name: copy.settings.tabProfile }));
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.settings.loadError);
    expect(screen.queryByRole("button", { name: copy.settings.saveBusiness })).not.toBeInTheDocument();
    expect(api.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it.each(["profile", "receipt"])("blocks default writes after a failed %s read and retries the real data", async (source) => {
    const getter = source === "profile" ? api.getBusinessProfile : api.getReceiptSettings;
    vi.mocked(getter).mockRejectedValueOnce(new Error("Network unavailable"));
    renderSettings(source === "profile" ? "/settings/business-profile" : "/settings/receipt");
    expect(await screen.findByRole("alert")).toHaveTextContent(copy.settings.loadError);
    expect(screen.queryByRole("button", { name: source === "profile" ? copy.settings.saveBusiness : copy.settings.saveReceipt })).not.toBeInTheDocument();
    expect(api.saveBusinessProfile).not.toHaveBeenCalled();
    expect(api.saveReceiptSettings).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: copy.dashboard.retry }));
    if (source === "profile") expect(await screen.findByLabelText(copy.settings.supportEmail)).toHaveValue("contacto@example.com");
    else expect(await screen.findByLabelText(copy.settings.receiptPaperWidth)).toHaveValue("58");
  });

  it("loads permitted manager settings without requesting owner-only employee data", async () => {
    auth.role = "manager";
    vi.mocked(api.listEmployees).mockRejectedValue(new Error("403 Forbidden"));
    vi.mocked(api.listInvitations).mockRejectedValue(new Error("403 Forbidden"));
    renderSettings();
    expect(await screen.findByLabelText(copy.settings.publicName)).toHaveValue("Negocio");
    expect(api.listEmployees).not.toHaveBeenCalled();
    expect(api.listInvitations).not.toHaveBeenCalled();
    expect(screen.queryByRole("link", { name: copy.settings.tabEmployees })).not.toBeInTheDocument();
  });

  it("ignores a delayed old tenant response after switching to another business", async () => {
    const oldProfile = deferred<api.BusinessProfile>();
    vi.mocked(api.getBusinessProfile).mockReturnValueOnce(oldProfile.promise);
    const view = renderSettings();
    await waitFor(() => expect(api.getBusinessProfile).toHaveBeenCalledOnce());
    auth.tenantId = "tenant-2";
    vi.mocked(api.getBusinessProfile).mockResolvedValue({ tenant_id: "tenant-2", public_name: "Nuevo negocio",
      support_email: null, support_phone: null, timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN" });
    view.rerender(<MemoryRouter><ToastProvider><SettingsView /></ToastProvider></MemoryRouter>);
    expect(await screen.findByLabelText(copy.settings.publicName)).toHaveValue("Nuevo negocio");
    await act(async () => oldProfile.resolve({ tenant_id: "tenant-1", public_name: "Negocio anterior",
      support_email: null, support_phone: null, timezone: "America/Tijuana", locale: "es-MX", currency: "MXN" }));
    expect(screen.getByLabelText(copy.settings.publicName)).toHaveValue("Nuevo negocio");
    expect(api.saveBusinessProfile).not.toHaveBeenCalled();
  });

  it("sends one invitation while pending and preserves input after rejection", async () => {
    const request = deferred<api.Invitation>();
    vi.mocked(api.inviteEmployee).mockReturnValueOnce(request.promise);
    renderSettings("/settings/employees");
    const input = await screen.findByLabelText(copy.settings.employeeEmail);
    fireEvent.change(input, { target: { value: "caja@example.com" } });
    const button = screen.getByRole("button", { name: copy.settings.invite });
    fireEvent.submit(button.closest("form")!);
    fireEvent.submit(button.closest("form")!);
    expect(api.inviteEmployee).toHaveBeenCalledTimes(1);
    expect(button).toBeDisabled();
    request.resolve({ id: "invite-1", email: "caja@example.com", role: "cashier", status: "pending", created_at: "2026-10-08" });
    await waitFor(() => expect(api.listEmployees).toHaveBeenCalledTimes(2));
    vi.mocked(api.inviteEmployee).mockRejectedValueOnce(new Error("Network unavailable"));
    fireEvent.change(await screen.findByLabelText(copy.settings.employeeEmail), { target: { value: "otra@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: copy.settings.invite }));
    expect(await screen.findByText(copy.settings.saveError)).toBeVisible();
    expect(screen.getByLabelText(copy.settings.employeeEmail)).toHaveValue("otra@example.com");
  });

  it("does not reload the old business after a pending save finishes in another session", async () => {
    const save = deferred<api.BusinessProfile>();
    vi.mocked(api.saveBusinessProfile).mockReturnValueOnce(save.promise);
    const view = renderSettings();
    const button = await screen.findByRole("button", { name: copy.settings.saveBusiness });
    fireEvent.click(button);
    auth.tenantId = "tenant-2";
    vi.mocked(api.getBusinessProfile).mockResolvedValue({ tenant_id: "tenant-2", public_name: "Nuevo negocio",
      support_email: null, support_phone: null, timezone: "America/Mexico_City", locale: "es-MX", currency: "MXN" });
    view.rerender(<MemoryRouter><ToastProvider><SettingsView /></ToastProvider></MemoryRouter>);
    expect(await screen.findByLabelText(copy.settings.publicName)).toHaveValue("Nuevo negocio");
    await act(async () => save.resolve({ tenant_id: "tenant-1", public_name: "Negocio anterior",
      support_email: null, support_phone: null, timezone: "America/Tijuana", locale: "es-MX", currency: "MXN" }));
    expect(screen.getByLabelText(copy.settings.publicName)).toHaveValue("Nuevo negocio");
    expect(screen.getByRole("button", { name: copy.settings.saveBusiness })).toBeEnabled();
    expect(api.getBusinessProfile).toHaveBeenCalledTimes(2);
  });

  it("retains the confirmation and explains a rejected role change without changing the employee", async () => {
    vi.mocked(api.listEmployees).mockResolvedValue([{ membership_id: "member-1", user_id: "user-1", email: "caja@example.com", role: "cashier", is_active: true, created_at: "2026-10-08" }]);
    vi.mocked(api.updateEmployeeRole).mockRejectedValueOnce(new Error("Network unavailable"));
    renderSettings("/settings/employees");
    fireEvent.change(await screen.findByRole("combobox", { name: "Rol de caja@example.com" }), { target: { value: "manager" } });
    fireEvent.click(screen.getByRole("button", { name: copy.settings.roleChangeConfirmAction }));
    expect(await screen.findByText(copy.settings.saveError)).toBeVisible();
    expect(screen.getByRole("dialog", { name: copy.settings.roleChangeConfirmTitle })).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Rol de caja@example.com" })).toHaveValue("cashier");
  });

  it("discards an old business confirmation and ignores its completion after another confirmation opens", async () => {
    const update = deferred<api.Employee>();
    const oldEmployee: api.Employee = { membership_id: "member-1", user_id: "user-1", email: "anterior@example.com", role: "cashier", is_active: true, created_at: "2026-10-08" };
    vi.mocked(api.listEmployees).mockResolvedValue([oldEmployee]);
    vi.mocked(api.updateEmployeeRole).mockReturnValueOnce(update.promise);
    const view = renderSettings("/settings/employees");
    fireEvent.change(await screen.findByRole("combobox", { name: "Rol de anterior@example.com" }), { target: { value: "manager" } });
    fireEvent.click(screen.getByRole("button", { name: copy.settings.roleChangeConfirmAction }));
    auth.tenantId = "tenant-2";
    vi.mocked(api.listEmployees).mockResolvedValue([{ ...oldEmployee, membership_id: "member-2", email: "nuevo@example.com" }]);
    view.rerender(<MemoryRouter><ToastProvider><SettingsView /></ToastProvider></MemoryRouter>);
    const newRole = await screen.findByRole("combobox", { name: "Rol de nuevo@example.com" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    fireEvent.change(newRole, { target: { value: "manager" } });
    expect(screen.getByRole("dialog")).toHaveTextContent("nuevo@example.com");
    await act(async () => update.resolve({ ...oldEmployee, role: "manager" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("nuevo@example.com");
    expect(screen.getByRole("button", { name: copy.settings.roleChangeConfirmAction })).toBeEnabled();
  });
});
