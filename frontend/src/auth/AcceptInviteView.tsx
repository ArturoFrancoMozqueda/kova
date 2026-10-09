import { FormEvent, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, AlertCircle, CheckCircle2, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthLayout } from "./AuthLayout";
import { copy } from "@/i18n/messages";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";
import { csrfHeaders } from "@/lib/csrf";
import { ApiError } from "./api";
import { hasPasswordByteLimitError, passwordExceedsByteLimit } from "./passwordRules";

type Preview = {
  email: string;
  role: "owner" | "manager" | "cashier";
  tenant_name: string;
  requires_password: boolean;
};

type Phase = "loading" | "ready" | "submitting" | "success" | "invalid" | "missing";

const ROLE_LABEL: Record<Preview["role"], string> = {
  owner: copy.auth.acceptInviteRoleOwner,
  manager: copy.auth.acceptInviteRoleManager,
  cashier: copy.auth.acceptInviteRoleCashier,
};

async function fetchPreview(token: string): Promise<Preview> {
  const response = await fetch(
    `/api/v1/employees/invitations/preview?token=${encodeURIComponent(token)}`,
  );
  if (!response.ok) {
    throw new Error(String(response.status));
  }
  return (await response.json()) as Preview;
}

async function postAccept(token: string, password: string | null): Promise<void> {
  const response = await fetch("/api/v1/employees/invitations/accept", {
    method: "POST",
    headers: { "content-type": "application/json", ...csrfHeaders("POST") },
    body: JSON.stringify({ token, password }),
  });
  if (!response.ok) {
    throw new ApiError(await response.text(), response.status);
  }
}

export default function AcceptInviteView() {
  useDocumentTitle(copy.auth.acceptInviteTitle);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);

  const [phase, setPhase] = useState<Phase>(token ? "loading" : "missing");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    fetchPreview(token)
      .then((data) => {
        if (!active) return;
        setPreview(data);
        setPhase("ready");
      })
      .catch(() => {
        if (!active) return;
        setPhase("invalid");
      });
    return () => {
      active = false;
    };
  }, [token]);

  const tooShort = preview?.requires_password && password.length > 0 && password.length < 8;
  const tooLong = preview?.requires_password && passwordExceedsByteLimit(password);
  const passwordHint = tooLong ? copy.auth.signupPasswordTooLong
    : tooShort ? copy.auth.resetPasswordTooShort : passwordError;
  const mismatch =
    preview?.requires_password && confirmation.length > 0 && password !== confirmation;
  const passwordOk =
    !preview?.requires_password ||
    (password.length >= 8 && !tooLong && password === confirmation);
  const canSubmit = (phase === "ready" || phase === "submitting") && passwordOk;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (phase !== "ready" || !passwordOk || !preview) return;
    setPhase("submitting");
    try {
      await postAccept(token, preview.requires_password ? password : null);
      setPhase("success");
      window.setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422 && hasPasswordByteLimitError(err.message)) {
        setPasswordError(copy.auth.signupPasswordTooLong);
        setPhase("ready");
        return;
      }
      setPhase("invalid");
    }
  };

  if (phase === "missing") {
    return (
      <ShellCard heading={copy.auth.acceptInviteMissingTitle}>
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{copy.auth.acceptInviteMissingBody}</span>
        </div>
      </ShellCard>
    );
  }

  if (phase === "invalid") {
    return (
      <ShellCard heading={copy.auth.acceptInviteInvalidTitle}>
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{copy.auth.acceptInviteInvalidBody}</span>
        </div>
      </ShellCard>
    );
  }

  if (phase === "loading" || !preview) {
    return (
      <ShellCard heading={copy.auth.acceptInviteTitle}>
        <div className="flex flex-col items-center gap-3 py-4">
          <Loader2 className="h-8 w-8 text-kova-blue animate-spin" />
          <p className="text-muted-foreground">{copy.auth.acceptInviteLoading}</p>
        </div>
      </ShellCard>
    );
  }

  if (phase === "success") {
    return (
      <ShellCard heading={copy.auth.acceptInviteTitle}>
        <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
          <CheckCircle2 className="h-10 w-10 text-kova-growth" />
          <p className="font-medium text-success text-center">
            {copy.auth.acceptInviteSuccess}
          </p>
        </div>
      </ShellCard>
    );
  }

  return (
    <ShellCard
      heading={copy.auth.acceptInviteTitle}
      subtitle={copy.auth.acceptInviteSummary(preview.tenant_name, ROLE_LABEL[preview.role])}
    >
      <form onSubmit={(event) => void submit(event)} className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor="email">{copy.auth.email}</Label>
          <Input id="email" type="email" value={preview.email} disabled readOnly />
        </div>

        {preview.requires_password ? (
          <>
            <p className="text-sm text-muted-foreground">
              {copy.auth.acceptInviteNewAccountSubtitle}
            </p>
            <div className="space-y-2">
              <Label htmlFor="password">{copy.auth.resetPasswordNew}</Label>
              <Input
                id="password"
                required
                type="password"
                autoComplete="new-password"
                placeholder={copy.auth.resetPasswordPlaceholder}
                value={password}
                onChange={(event) => { setPassword(event.target.value); setPasswordError(null); }}
                aria-invalid={passwordHint ? "true" : undefined}
                aria-describedby={passwordHint ? "password-hint" : undefined}
              />
              {passwordHint && (
                <p id="password-hint" className="text-xs text-destructive">{passwordHint}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmation">{copy.auth.resetPasswordConfirm}</Label>
              <Input
                id="confirmation"
                required
                type="password"
                autoComplete="new-password"
                placeholder={copy.auth.resetPasswordPlaceholder}
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-invalid={mismatch ? "true" : undefined}
              />
              {mismatch && (
                <p className="text-xs text-destructive">{copy.auth.resetPasswordMismatch}</p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {copy.auth.acceptInviteExistingAccountSubtitle}
          </p>
        )}

        <Button
          type="submit"
          className="w-full"
          size="lg"
          disabled={!canSubmit || phase === "submitting"}
        >
          {phase === "submitting" ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              {copy.auth.submitting}
            </>
          ) : (
            <>
              {copy.auth.acceptInviteSubmit}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>

        <div className="text-center text-sm text-muted-foreground">
          <Link
            to="/login"
            className="font-medium text-kova-blue hover:underline"
          >
            {copy.auth.backToLogin}
          </Link>
        </div>
      </form>
    </ShellCard>
  );
}

function ShellCard({
  heading,
  subtitle,
  children,
}: {
  heading: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <AuthLayout title={heading} subtitle={subtitle}>
      {children}
    </AuthLayout>
  );
}
