import { FormEvent, useCallback, useEffect, useId, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ViewHeader } from "@/components/ui/view-header";
import { ViewLayout } from "@/components/ui/view-layout";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { FiscalGlobalDraftsPanel } from "@/fiscal/FiscalGlobalDraftsPanel";
import { useToast } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
import { ReceiptTemplate } from "@/orders/ReceiptTemplate";
import { TicketPaper } from "@/components/ui/ticket";
import { LogoUploadField } from "./LogoUploadField";
import {
  cancelAccountDeletion,
  deactivateEmployee,
  downloadAccountExport,
  getAccountDeletionStatus,
  getBusinessProfile,
  getReceiptSettings,
  inviteEmployee,
  listEmployees,
  listInvitations,
  resendInvitation,
  revokeInvitation,
  saveBusinessProfile,
  saveReceiptSettings,
  scheduleAccountDeletion,
  updateEmployeeRole,
  type Employee,
  type Invitation,
  type AccountDeletionStatus,
} from "./api";
import { cn } from "@/lib/utils";
import {
  cacheReceiptPaperWidth,
  normalizeReceiptPaperWidth,
  type ReceiptPaperWidth,
} from "@/lib/receiptPaper";

type LoadState = "loading" | "ready" | "error";
type Role = "owner" | "manager" | "cashier";
type SettingsTab = "profile" | "receipt" | "employees" | "fiscal" | "advanced";

const roleOptions: { value: Role; label: string; description: string }[] = [
  {
    value: "owner",
    label: copy.settings.roleOwner,
    description: copy.settings.roleOwnerDescription,
  },
  {
    value: "manager",
    label: copy.settings.roleManager,
    description: copy.settings.roleManagerDescription,
  },
  {
    value: "cashier",
    label: copy.settings.roleCashier,
    description: copy.settings.roleCashierDescription,
  },
];

const localeOptions = [
  { value: "es-MX", label: "Español (México)" },
];

const currencyOptions = [
  { value: "MXN", label: "MXN — Peso mexicano" },
  { value: "USD", label: "USD — Dólar estadounidense" },
];

const timezoneOptions = [
  { value: "America/Mexico_City", label: "Ciudad de México (CDMX)" },
  { value: "America/Tijuana", label: "Tijuana (Baja California)" },
  { value: "America/Hermosillo", label: "Hermosillo (Sonora)" },
  { value: "America/Mazatlan", label: "Mazatlán (Sinaloa, Nayarit)" },
  { value: "America/Monterrey", label: "Monterrey (Nuevo León)" },
  { value: "America/Merida", label: "Mérida (Yucatán)" },
  { value: "America/Cancun", label: "Cancún (Quintana Roo)" },
  { value: "America/Chihuahua", label: "Chihuahua" },
  { value: "America/Ojinaga", label: "Ojinaga" },
  { value: "America/Matamoros", label: "Matamoros" },
  { value: "America/Bahia_Banderas", label: "Bahía de Banderas (Nayarit)" },
];

const settingsTabs: { id: SettingsTab; label: string; to: string }[] = [
  { id: "profile", label: copy.settings.tabProfile, to: "/settings/business-profile" },
  { id: "receipt", label: copy.settings.tabReceipt, to: "/settings/receipt" },
  { id: "employees", label: copy.settings.tabEmployees, to: "/settings/employees" },
  { id: "fiscal", label: copy.settings.tabFiscal, to: "/settings/fiscal" },
  { id: "advanced", label: copy.settings.tabAdvanced, to: "/settings/advanced" },
];

function tabFromPath(pathname: string): SettingsTab {
  if (pathname.endsWith("/receipt")) return "receipt";
  if (pathname.endsWith("/employees")) return "employees";
  if (pathname.endsWith("/fiscal")) return "fiscal";
  if (pathname.endsWith("/advanced")) return "advanced";
  return "profile";
}

function roleLabel(role: Role | string): string {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function roleDescription(role: Role | string): string {
  return roleOptions.find((option) => option.value === role)?.description ?? "";
}

function invitationStatusLabel(status: string): string {
  switch (status) {
    case "pending":
      return copy.settings.inviteStatusPending;
    case "revoked":
      return copy.settings.inviteStatusRevoked;
    case "accepted":
      return copy.settings.inviteStatusAccepted;
    case "expired":
      return copy.settings.inviteStatusExpired;
    default:
      return status;
  }
}

export default function SettingsView() {
  useDocumentTitle(copy.documentTitles.settings);
  const location = useLocation();
  const { state, refresh } = useAuth();
  const { toast } = useToast();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
  const tenantId = state.status === "authenticated" ? state.tenantId : "";
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [business, setBusiness] = useState({
    public_name: tenantName,
    support_email: "",
    support_phone: "",
    timezone: "America/Mexico_City",
    locale: "es-MX",
    currency: "MXN",
  });
  const [receipt, setReceipt] = useState({
    receipt_business_name: tenantName,
    footer: "",
    tax_contact_text: "",
    logo_url: "",
    paper_width_mm: 80 as ReceiptPaperWidth,
  });
  const [invite, setInvite] = useState<{ email: string; role: Role }>({
    email: "",
    role: "cashier",
  });
  const [pendingAction, setPendingAction] = useState<{
    title: string;
    body: string;
    confirmLabel: string;
    run: () => Promise<void>;
  } | null>(null);
  const [actionBusy, setActionBusy] = useState(false);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [deletionStatus, setDeletionStatus] = useState<AccountDeletionStatus | null>(null);
  const [deletionConfirmation, setDeletionConfirmation] = useState({
    tenantName: "",
    password: "",
  });
  const activeTab = tabFromPath(location.pathname);
  const isOwner = state.status === "authenticated" && state.user.role === "owner";
  const userRole = state.status === "authenticated" ? state.user.role : "";
  const canViewFiscal =
    state.status === "authenticated" &&
    state.featureFlags.fiscal_global_drafts &&
    (userRole === "owner" || userRole === "manager");
  const visibleSettingsTabs = settingsTabs.filter((tab) => tab.id !== "fiscal" || canViewFiscal);
  const visibleActiveTab = activeTab === "fiscal" && !canViewFiscal ? "profile" : activeTab;

  const runPendingAction = useCallback(async () => {
    if (!pendingAction) return;
    setActionBusy(true);
    try {
      await pendingAction.run();
    } finally {
      setActionBusy(false);
      setPendingAction(null);
    }
  }, [pendingAction]);

  const load = useCallback(async () => {
    setLoadState("loading");
    try {
      const [profile, receiptSettings, employeeRows, invitationRows] = await Promise.all([
        getBusinessProfile().catch(() => null),
        getReceiptSettings().catch(() => null),
        listEmployees(),
        listInvitations(),
      ]);
      if (profile) {
        setBusiness({
          public_name: profile.public_name,
          support_email: profile.support_email ?? "",
          support_phone: profile.support_phone ?? "",
          timezone: profile.timezone,
          locale: profile.locale,
          currency: profile.currency,
        });
      }
      if (receiptSettings) {
        setReceipt({
          receipt_business_name: receiptSettings.receipt_business_name,
          footer: receiptSettings.footer ?? "",
          tax_contact_text: receiptSettings.tax_contact_text ?? "",
          logo_url: receiptSettings.logo_url ?? "",
          paper_width_mm: normalizeReceiptPaperWidth(receiptSettings.paper_width_mm),
        });
        cacheReceiptPaperWidth(
          tenantId,
          normalizeReceiptPaperWidth(receiptSettings.paper_width_mm),
        );
      }
      setEmployees(employeeRows);
      setInvitations(invitationRows);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, [tenantId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isOwner) return;
    void getAccountDeletionStatus().then(setDeletionStatus).catch(() => null);
  }, [isOwner]);

  async function exportAccount() {
    setLifecycleBusy(true);
    try {
      await downloadAccountExport();
      toast(copy.settings.accountExportReady, "success");
    } catch {
      toast(copy.settings.accountLifecycleError, "error");
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function submitDeletion(event: FormEvent) {
    event.preventDefault();
    setLifecycleBusy(true);
    try {
      const status = await scheduleAccountDeletion({
        password: deletionConfirmation.password,
        tenant_name: deletionConfirmation.tenantName,
      });
      setDeletionStatus(status);
      setDeletionConfirmation({ tenantName: "", password: "" });
      toast(copy.settings.accountDeletionScheduled, "success");
    } catch {
      toast(copy.settings.accountDeletionConfirmError, "error");
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function undoDeletion() {
    setLifecycleBusy(true);
    try {
      await cancelAccountDeletion();
      setDeletionStatus({ status: "none", requested_at: null, purge_after: null });
      toast(copy.settings.accountDeletionCanceled, "success");
    } catch {
      toast(copy.settings.accountLifecycleError, "error");
    } finally {
      setLifecycleBusy(false);
    }
  }

  async function submitBusiness(event: FormEvent) {
    event.preventDefault();
    try {
      await saveBusinessProfile({
        ...business,
        support_email: business.support_email || null,
        support_phone: business.support_phone || null,
      });
      toast(copy.settings.saved, "success");
      void load();
      void refresh();
    } catch {
      toast(copy.settings.saveError, "error");
    }
  }

  async function submitReceipt(event: FormEvent) {
    event.preventDefault();
    try {
      const saved = await saveReceiptSettings({
        ...receipt,
        footer: receipt.footer || null,
        tax_contact_text: receipt.tax_contact_text || null,
        logo_url: receipt.logo_url || null,
      });
      cacheReceiptPaperWidth(tenantId, normalizeReceiptPaperWidth(saved.paper_width_mm));
      toast(copy.settings.saved, "success");
      void load();
    } catch {
      toast(copy.settings.saveError, "error");
    }
  }

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    try {
      await inviteEmployee(invite);
      setInvite({ email: "", role: "cashier" });
      toast(copy.settings.inviteSent, "success");
      void load();
    } catch {
      toast(copy.settings.saveError, "error");
    }
  }

  if (loadState === "loading") {
    return (
      <ViewLayout width="focused" className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </ViewLayout>
    );
  }

  if (loadState === "error") {
    return (
      <ViewLayout width="focused">
        <Card>
          <CardContent className="p-6">
            <p className="font-medium">{copy.settings.loadError}</p>
            <Button className="mt-4" onClick={() => void load()}>{copy.dashboard.retry}</Button>
          </CardContent>
        </Card>
      </ViewLayout>
    );
  }

  return (
    <ViewLayout width="standard" className="space-y-6">
      <ViewHeader title={copy.settings.title} meta={copy.settings.subtitle} />

      <div className="grid items-start gap-5 lg:grid-cols-[220px_minmax(0,1fr)]">
      <nav
        aria-label={copy.settings.tabsLabel}
        className="flex gap-1 overflow-x-auto rounded-kova-lg border border-kova-border bg-white p-1.5 shadow-kova-card lg:sticky lg:top-4 lg:flex-col"
      >
        {visibleSettingsTabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            className={cn(
              "shrink-0 rounded-kova-sm px-3 py-2.5 text-sm font-medium transition-colors",
              visibleActiveTab === tab.id
                ? "bg-kova-ink text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      <section className="min-w-0 space-y-6">

      {visibleActiveTab === "profile" && (
      <Card>
        <CardHeader><CardTitle>{copy.settings.businessProfile}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitBusiness}>
            <Field label={copy.settings.publicName} value={business.public_name} onChange={(value) => setBusiness((x) => ({ ...x, public_name: value }))} required />
            <Field label={copy.settings.supportEmail} value={business.support_email} onChange={(value) => setBusiness((x) => ({ ...x, support_email: value }))} />
            <Field label={copy.settings.supportPhone} value={business.support_phone} onChange={(value) => setBusiness((x) => ({ ...x, support_phone: value }))} />
            <LogoUploadField logoUrl={receipt.logo_url} setReceipt={setReceipt} />
            <Button className="sm:col-span-2 justify-self-start" type="submit">{copy.settings.saveBusiness}</Button>
          </form>
        </CardContent>
      </Card>
      )}

      {visibleActiveTab === "receipt" && (
      <Card>
        <CardHeader><CardTitle>{copy.settings.receiptSettings}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitReceipt}>
              <Field label={copy.settings.receiptName} value={receipt.receipt_business_name} onChange={(value) => setReceipt((x) => ({ ...x, receipt_business_name: value }))} required />
              <Field label={copy.settings.receiptFooter} value={receipt.footer} onChange={(value) => setReceipt((x) => ({ ...x, footer: value }))} />
              <Field label={copy.settings.taxContact} value={receipt.tax_contact_text} onChange={(value) => setReceipt((x) => ({ ...x, tax_contact_text: value }))} />
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="receipt-paper-width">{copy.settings.receiptPaperWidth}</Label>
                <Select
                  id="receipt-paper-width"
                  value={String(receipt.paper_width_mm)}
                  onChange={(event) => setReceipt((current) => ({
                    ...current,
                    paper_width_mm: normalizeReceiptPaperWidth(event.target.value),
                  }))}
                >
                  <option value="80">{copy.settings.receiptPaper80}</option>
                  <option value="58">{copy.settings.receiptPaper58}</option>
                </Select>
                <p className="text-xs leading-5 text-muted-foreground">
                  {copy.settings.receiptPaperHint}
                </p>
              </div>
              <Button className="sm:col-span-2 justify-self-start" type="submit">{copy.settings.saveReceipt}</Button>
            </form>
            <ReceiptPreview receipt={receipt} />
          </div>
        </CardContent>
      </Card>
      )}

      {visibleActiveTab === "employees" && (
      <Card>
        <CardHeader>
          <CardTitle>{copy.settings.employees}</CardTitle>
          <p className="text-sm text-muted-foreground">{copy.settings.inviteHelp}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            {roleOptions.map((option) => (
              <div key={option.value} className="rounded-kova-md border border-kova-border bg-kova-mist p-3">
                <p className="text-sm font-medium">{option.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
              </div>
            ))}
          </div>

          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-start" onSubmit={submitInvite}>
            <div className="flex-1">
              <Label htmlFor="employee-invite-email">{copy.settings.employeeEmail}</Label>
              <Input id="employee-invite-email" type="email" value={invite.email} onChange={(e) => setInvite((x) => ({ ...x, email: e.target.value }))} required />
            </div>
            <div>
              <Label htmlFor="employee-invite-role">{copy.settings.role}</Label>
              <Select id="employee-invite-role" value={invite.role} onChange={(e) => setInvite((x) => ({ ...x, role: e.target.value as Role }))}>
                {roleOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </Select>
              <p className="mt-1 text-xs leading-5 text-muted-foreground">
                {roleDescription(invite.role)}
              </p>
            </div>
            <Button className="sm:mt-6" type="submit">{copy.settings.invite}</Button>
          </form>

          <div className="space-y-2">
            {employees.map((employee) => (
              <div key={employee.membership_id} className="flex flex-col gap-3 rounded-kova-md border border-kova-border p-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">{employee.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {employee.is_active ? copy.settings.active : copy.settings.inactive}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {roleDescription(employee.role)}
                  </p>
                </div>
                <Select
                  className="sm:w-44"
                  value={employee.role}
                  disabled={!employee.is_active}
                  onChange={(e) => {
                    const newRole = e.target.value as Role;
                    if (newRole === employee.role) return;
                    setPendingAction({
                      title: copy.settings.roleChangeConfirmTitle,
                      body: copy.settings.roleChangeConfirmBody(
                        employee.email,
                        roleLabel(employee.role),
                        roleLabel(newRole),
                      ),
                      confirmLabel: copy.settings.roleChangeConfirmAction,
                      run: () => updateEmployeeRole(employee.membership_id, newRole).then(load),
                    });
                  }}
                >
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
                <Button
                  variant="outline"
                  disabled={!employee.is_active}
                  onClick={() =>
                    setPendingAction({
                      title: copy.settings.deactivateConfirmTitle,
                      body: copy.settings.deactivateConfirmBody(employee.email),
                      confirmLabel: copy.settings.deactivateConfirmAction,
                      run: () => deactivateEmployee(employee.membership_id).then(load),
                    })
                  }
                >
                  {copy.settings.deactivate}
                </Button>
              </div>
            ))}
          </div>

          {invitations.length > 0 && (
            <div className="rounded-kova-lg bg-kova-mist/70 p-3">
              <p className="mb-2 text-sm font-medium">{copy.settings.pendingInvites}</p>
              <div className="space-y-2">
                {invitations.map((row) => {
                  const isPending = row.status === "pending";
                  return (
                    <div
                      key={row.id}
                      className="flex flex-col gap-2 rounded-kova-md border border-kova-border bg-white p-3 sm:flex-row sm:items-center"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{row.email}</p>
                        <p className="text-xs text-muted-foreground">{roleLabel(row.role)}</p>
                      </div>
                      <Badge variant={isPending ? "warning" : "secondary"} className="shrink-0">
                        {invitationStatusLabel(row.status)}
                      </Badge>
                      {isPending && (
                        <div className="flex shrink-0 gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              void resendInvitation(row).then(() => {
                                toast(copy.settings.resendInviteSuccess, "success");
                                return load();
                              })
                            }
                          >
                            {copy.settings.resendInvite}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setPendingAction({
                                title: copy.settings.revokeInviteConfirmTitle,
                                body: copy.settings.revokeInviteConfirmBody(row.email),
                                confirmLabel: copy.settings.revokeInviteConfirmAction,
                                run: () => revokeInvitation(row.id).then(load),
                              })
                            }
                          >
                            {copy.settings.revokeInvite}
                          </Button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {visibleActiveTab === "fiscal" && canViewFiscal && (
        <FiscalGlobalDraftsPanel role={userRole} tenantName={tenantName} />
      )}

      {visibleActiveTab === "advanced" && (
        <>
        <Card>
          <CardHeader>
            <CardTitle>{copy.settings.advanced}</CardTitle>
          </CardHeader>
          <CardContent>
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitBusiness}>
              <SelectField
                label={copy.settings.timezone}
                value={business.timezone}
                options={timezoneOptions}
                onChange={(value) => setBusiness((x) => ({ ...x, timezone: value }))}
              />
              <SelectField
                label={copy.settings.locale}
                value={business.locale}
                options={localeOptions}
                onChange={(value) => setBusiness((x) => ({ ...x, locale: value }))}
              />
              <SelectField
                label={copy.settings.currency}
                value={business.currency}
                options={currencyOptions}
                onChange={(value) => setBusiness((x) => ({ ...x, currency: value }))}
              />
              <p className="text-sm leading-6 text-muted-foreground sm:col-span-2">
                {copy.settings.advancedHint}
              </p>
              <Button className="sm:col-span-2 justify-self-start" type="submit">{copy.settings.saveBusiness}</Button>
            </form>
          </CardContent>
        </Card>
        {isOwner && (
          <Card>
            <CardHeader>
              <CardTitle>{copy.settings.accountDataTitle}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col gap-3 rounded-kova-md border border-kova-border p-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{copy.settings.accountExportTitle}</p>
                  <p className="mt-1 text-sm leading-6 text-muted-foreground">
                    {copy.settings.accountExportHint}
                  </p>
                </div>
                <Button variant="outline" disabled={lifecycleBusy} onClick={() => void exportAccount()}>
                  {copy.settings.accountExportAction}
                </Button>
              </div>

              <div className="rounded-kova-md border border-red-200 bg-red-50/40 p-4">
                <p className="font-medium text-red-900">{copy.settings.accountDeletionTitle}</p>
                {deletionStatus?.status === "pending" ? (
                  <div className="mt-2 space-y-3">
                    <p className="text-sm leading-6 text-red-800">
                      {copy.settings.accountDeletionPending(
                        deletionStatus.purge_after
                          ? new Intl.DateTimeFormat("es-MX", { dateStyle: "long" }).format(
                              new Date(deletionStatus.purge_after),
                            )
                          : "",
                      )}
                    </p>
                    <Button variant="outline" disabled={lifecycleBusy} onClick={() => void undoDeletion()}>
                      {copy.settings.accountDeletionCancel}
                    </Button>
                  </div>
                ) : (
                  <form className="mt-2 grid max-w-xl gap-4" onSubmit={submitDeletion}>
                    <p className="text-sm leading-6 text-red-800">
                      {copy.settings.accountDeletionHint}
                    </p>
                    <Field
                      label={copy.settings.accountDeletionNameLabel(tenantName)}
                      value={deletionConfirmation.tenantName}
                      onChange={(value) =>
                        setDeletionConfirmation((current) => ({ ...current, tenantName: value }))
                      }
                      required
                    />
                    <div className="space-y-1">
                      <Label htmlFor="account-deletion-password">
                        {copy.settings.accountDeletionPassword}
                      </Label>
                      <Input
                        id="account-deletion-password"
                        type="password"
                        autoComplete="current-password"
                        value={deletionConfirmation.password}
                        onChange={(event) =>
                          setDeletionConfirmation((current) => ({
                            ...current,
                            password: event.target.value,
                          }))
                        }
                        required
                      />
                    </div>
                    <Button
                      className="justify-self-start"
                      variant="destructive"
                      disabled={
                        lifecycleBusy || deletionConfirmation.tenantName !== tenantName
                      }
                      type="submit"
                    >
                      {copy.settings.accountDeletionAction}
                    </Button>
                  </form>
                )}
              </div>
            </CardContent>
          </Card>
        )}
        </>
      )}
      </section>
      </div>

      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ""}
        description={pendingAction?.body}
        confirmLabel={pendingAction?.confirmLabel}
        busy={actionBusy}
        onConfirm={() => void runPendingAction()}
        onCancel={() => setPendingAction(null)}
      />
    </ViewLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </div>
  );
}

type ReceiptDraft = {
  receipt_business_name: string;
  footer: string;
  tax_contact_text: string;
  logo_url: string;
  paper_width_mm: ReceiptPaperWidth;
};

function ReceiptPreview({ receipt }: { receipt: ReceiptDraft }) {
  const name = receipt.receipt_business_name.trim() || copy.settings.receiptPreviewPlaceholderName;

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {copy.settings.receiptPreviewTitle}
      </p>
      <TicketPaper
        className="max-w-xs transition-[width] duration-quick ease-standard"
        style={{ width: receipt.paper_width_mm === 58 ? "218px" : "302px" }}
      >
        <ReceiptTemplate
          aria-label={copy.settings.receiptPreviewTitle}
          businessName={name}
          logoUrl={receipt.logo_url.trim() || undefined}
          taxContactText={receipt.tax_contact_text.trim() || undefined}
          footer={receipt.footer.trim() || undefined}
          createdAt={new Date()}
          paperWidthMm={receipt.paper_width_mm}
          items={[
            {
              product_name: copy.settings.receiptPreviewItem,
              quantity: 1,
              unit_price_amount: "120.00",
              line_total_amount: "120.00",
              modifiers: [],
            },
          ]}
          subtotalAmount="120.00"
          totalAmount="120.00"
          payments={[{ method: "cash", amount_amount: "120.00" }]}
        />
      </TicketPaper>
    </div>
  );
}
function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const known = options.some((option) => option.value === value);
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Select id={id} value={value} onChange={(event) => onChange(event.target.value)}>
        {!known && value ? <option value={value}>{value}</option> : null}
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </Select>
    </div>
  );
}
