import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useAuth } from "@/auth/useAuth";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { copy } from "@/i18n/messages";
import { formatMoney } from "@/orders/format";
import { LogoUploadField } from "./LogoUploadField";
import {
  deactivateEmployee,
  getBusinessProfile,
  getReceiptSettings,
  inviteEmployee,
  listEmployees,
  listInvitations,
  saveBusinessProfile,
  saveReceiptSettings,
  updateEmployeeRole,
  type Employee,
  type Invitation,
} from "./api";
import { cn } from "@/lib/utils";

type LoadState = "loading" | "ready" | "error";
type Role = "owner" | "manager" | "cashier";
type SettingsTab = "profile" | "receipt" | "employees" | "advanced";

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
  { id: "advanced", label: copy.settings.tabAdvanced, to: "/settings/advanced" },
];

function tabFromPath(pathname: string): SettingsTab {
  if (pathname.endsWith("/receipt")) return "receipt";
  if (pathname.endsWith("/employees")) return "employees";
  if (pathname.endsWith("/advanced")) return "advanced";
  return "profile";
}

function roleLabel(role: Role | string): string {
  return roleOptions.find((option) => option.value === role)?.label ?? role;
}

function roleDescription(role: Role | string): string {
  return roleOptions.find((option) => option.value === role)?.description ?? "";
}

export default function SettingsView() {
  useDocumentTitle("Configuración");
  const location = useLocation();
  const { state, refresh } = useAuth();
  const { toast } = useToast();
  const tenantName = state.status === "authenticated" ? state.tenantName : "";
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
  });
  const [invite, setInvite] = useState<{ email: string; role: Role }>({
    email: "",
    role: "cashier",
  });
  const activeTab = tabFromPath(location.pathname);

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
        });
      }
      setEmployees(employeeRows);
      setInvitations(invitationRows);
      setLoadState("ready");
    } catch {
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
      await saveReceiptSettings({
        ...receipt,
        footer: receipt.footer || null,
        tax_contact_text: receipt.tax_contact_text || null,
        logo_url: receipt.logo_url || null,
      });
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
      <main className="max-w-5xl mx-auto p-6 lg:p-8 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </main>
    );
  }

  if (loadState === "error") {
    return (
      <main className="max-w-5xl mx-auto p-6 lg:p-8">
        <Card>
          <CardContent className="p-6">
            <p className="font-medium">{copy.settings.loadError}</p>
            <Button className="mt-4" onClick={() => void load()}>{copy.dashboard.retry}</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="max-w-5xl mx-auto p-6 lg:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{copy.settings.title}</h1>
        <p className="text-sm text-muted-foreground">{copy.settings.subtitle}</p>
      </div>

      <nav
        aria-label={copy.settings.tabsLabel}
        className="flex gap-1 overflow-x-auto rounded-[var(--radius-md)] border bg-card p-1"
      >
        {settingsTabs.map((tab) => (
          <Link
            key={tab.id}
            to={tab.to}
            className={cn(
              "shrink-0 rounded-[var(--radius-sm)] px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "bg-kova-ink text-white"
                : "text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        ))}
      </nav>

      {activeTab === "profile" && (
      <Card>
        <CardHeader><CardTitle>{copy.settings.businessProfile}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitBusiness}>
            <Field label={copy.settings.publicName} value={business.public_name} onChange={(value) => setBusiness((x) => ({ ...x, public_name: value }))} required />
            <Field label={copy.settings.supportEmail} value={business.support_email} onChange={(value) => setBusiness((x) => ({ ...x, support_email: value }))} />
            <Field label={copy.settings.supportPhone} value={business.support_phone} onChange={(value) => setBusiness((x) => ({ ...x, support_phone: value }))} />
            <Button className="sm:col-span-2 justify-self-start" type="submit">{copy.settings.saveBusiness}</Button>
          </form>
        </CardContent>
      </Card>
      )}

      {activeTab === "receipt" && (
      <Card>
        <CardHeader><CardTitle>{copy.settings.receiptSettings}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
            <form className="grid gap-4 sm:grid-cols-2" onSubmit={submitReceipt}>
              <Field label={copy.settings.receiptName} value={receipt.receipt_business_name} onChange={(value) => setReceipt((x) => ({ ...x, receipt_business_name: value }))} required />
              <Field label={copy.settings.receiptFooter} value={receipt.footer} onChange={(value) => setReceipt((x) => ({ ...x, footer: value }))} />
              <Field label={copy.settings.taxContact} value={receipt.tax_contact_text} onChange={(value) => setReceipt((x) => ({ ...x, tax_contact_text: value }))} />
              <LogoUploadField logoUrl={receipt.logo_url} setReceipt={setReceipt} />
              <Button className="sm:col-span-2 justify-self-start" type="submit">{copy.settings.saveReceipt}</Button>
            </form>
            <ReceiptPreview receipt={receipt} />
          </div>
        </CardContent>
      </Card>
      )}

      {activeTab === "employees" && (
      <Card>
        <CardHeader>
          <CardTitle>{copy.settings.employees}</CardTitle>
          <p className="text-sm text-muted-foreground">{copy.settings.inviteHelp}</p>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="grid gap-3 md:grid-cols-3">
            {roleOptions.map((option) => (
              <div key={option.value} className="rounded-lg border bg-muted/20 p-3">
                <p className="text-sm font-medium">{option.label}</p>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">{option.description}</p>
              </div>
            ))}
          </div>

          <form className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px_auto] sm:items-start" onSubmit={submitInvite}>
            <div className="flex-1">
              <Label>{copy.settings.employeeEmail}</Label>
              <Input type="email" value={invite.email} onChange={(e) => setInvite((x) => ({ ...x, email: e.target.value }))} required />
            </div>
            <div>
              <Label>{copy.settings.role}</Label>
              <Select value={invite.role} onChange={(e) => setInvite((x) => ({ ...x, role: e.target.value as Role }))}>
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
              <div key={employee.membership_id} className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-center">
                <div className="flex-1">
                  <p className="font-medium">{employee.email}</p>
                  <p className="text-xs text-muted-foreground">
                    {employee.is_active ? copy.settings.active : copy.settings.inactive}
                  </p>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    {roleDescription(employee.role)}
                  </p>
                </div>
                <Select className="sm:w-44" value={employee.role} disabled={!employee.is_active} onChange={(e) => void updateEmployeeRole(employee.membership_id, e.target.value as Role).then(load)}>
                  {roleOptions.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </Select>
                <Button variant="outline" disabled={!employee.is_active} onClick={() => void deactivateEmployee(employee.membership_id).then(load)}>
                  {copy.settings.deactivate}
                </Button>
              </div>
            ))}
          </div>

          {invitations.length > 0 && (
            <div className="rounded-lg bg-muted/40 p-3 text-sm">
              <p className="font-medium mb-2">{copy.settings.pendingInvites}</p>
              {invitations.map((row) => (
                <p key={row.id} className="text-muted-foreground">{row.email} - {roleLabel(row.role)} - {row.status}</p>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
      )}

      {activeTab === "advanced" && (
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
      )}
    </main>
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
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} required={required} />
    </div>
  );
}

type ReceiptDraft = {
  receipt_business_name: string;
  footer: string;
  tax_contact_text: string;
  logo_url: string;
};

function ReceiptPreview({ receipt }: { receipt: ReceiptDraft }) {
  const name = receipt.receipt_business_name.trim() || copy.settings.receiptPreviewPlaceholderName;
  const logo = receipt.logo_url.trim();
  const taxText = receipt.tax_contact_text.trim();
  const footer = receipt.footer.trim();
  const now = new Date();
  const date = now.toLocaleDateString("es-MX", { year: "numeric", month: "2-digit", day: "2-digit" });
  const time = now.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
  const total = "120.00";

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {copy.settings.receiptPreviewTitle}
      </p>
      <div
        aria-label={copy.settings.receiptPreviewTitle}
        className="rounded-[var(--radius-lg)] border border-[color:var(--kova-border)] bg-white p-4 font-mono text-[11px] leading-snug text-[color:var(--kova-ink)] shadow-sm"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        <div className="flex flex-col items-center gap-2 text-center">
          {logo ? (
            <img
              src={logo}
              alt={copy.settings.receiptPreviewLogoAlt}
              className="h-10 w-auto object-contain"
              onError={(event) => {
                (event.currentTarget as HTMLImageElement).style.display = "none";
              }}
            />
          ) : null}
          <p className="text-sm font-semibold tracking-tight">{name}</p>
          {taxText ? <p className="whitespace-pre-line text-[10px] text-muted-foreground">{taxText}</p> : null}
          <p className="text-[10px] text-muted-foreground">
            {date} · {time}
          </p>
        </div>
        <div className="my-3 border-t border-dashed border-[color:var(--kova-border)]" />
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="truncate">
              {copy.settings.receiptPreviewQty} {copy.settings.receiptPreviewItem}
            </span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>
        <div className="my-3 border-t border-dashed border-[color:var(--kova-border)]" />
        <div className="space-y-1">
          <div className="flex justify-between">
            <span>{copy.settings.receiptPreviewSubtotal}</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span>{copy.settings.receiptPreviewTotal}</span>
            <span>{formatMoney(total)}</span>
          </div>
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{copy.settings.receiptPreviewPaid}</span>
            <span>{formatMoney(total)}</span>
          </div>
        </div>
        <div className="my-3 border-t border-dashed border-[color:var(--kova-border)]" />
        <p className="whitespace-pre-line text-center text-[10px] text-muted-foreground">
          {footer || copy.settings.receiptPreviewThanks}
        </p>
      </div>
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
  return (
    <div className="space-y-1">
      <Label>{label}</Label>
      <Select value={value} onChange={(event) => onChange(event.target.value)}>
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
