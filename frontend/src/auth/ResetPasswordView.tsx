import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { ApiError, confirmPasswordReset } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, Loader2 } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type State = "idle" | "submitting" | "success" | "error";

export default function ResetPasswordView() {
  useDocumentTitle(copy.documentTitles.resetPassword);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = useMemo(() => searchParams.get("token")?.trim() ?? "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [state, setState] = useState<State>("idle");
  const [errorMessage, setErrorMessage] = useState<string>(copy.auth.operationError);

  const mismatch = confirmation.length > 0 && password !== confirmation;
  const tooShort = password.length > 0 && password.length < 8;
  const weakPassword =
    password.length >= 8 && (!/[A-Za-z]/.test(password) || !/\d/.test(password));
  const passwordHint = tooShort
    ? copy.auth.resetPasswordTooShort
    : weakPassword
      ? copy.auth.resetPasswordWeak
      : null;
  const canSubmit =
    token.length > 0 &&
    password.length >= 8 &&
    !weakPassword &&
    password === confirmation &&
    state !== "submitting";

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setState("submitting");
    try {
      await confirmPasswordReset(token, password);
      setState("success");
      window.setTimeout(() => navigate("/login", { replace: true }), 2500);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        setErrorMessage(copy.auth.resetTokenInvalid);
      } else if (err instanceof ApiError && err.status === 422) {
        setErrorMessage(copy.auth.resetPasswordWeak);
      } else {
        setErrorMessage(copy.auth.operationError);
      }
      setState("error");
    }
  };

  if (!token) {
    return (
      <AuthLayout
        title={copy.auth.resetTokenMissingTitle}
        subtitle={copy.auth.resetTokenMissingBody}
        contentClassName="space-y-3"
      >
        <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>{copy.auth.resetTokenMissingHint}</span>
        </div>
        <Link
          to="/forgot-password"
          className="inline-flex items-center gap-1 text-sm font-medium text-kova-blue hover:underline"
        >
          <ArrowLeft className="h-4 w-4" />
          {copy.auth.resetTokenRequestAgain}
        </Link>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout title={copy.auth.resetPasswordTitle} subtitle={copy.auth.resetPasswordSubtitle}>
            {state === "success" ? (
              <div className="space-y-3">
                <div className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{copy.auth.resetPasswordSuccess}</span>
                </div>
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm font-medium text-kova-blue hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {copy.auth.backToLogin}
                </Link>
              </div>
            ) : (
              <form onSubmit={(event) => void submit(event)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="password">{copy.auth.resetPasswordNew}</Label>
                  <Input
                    id="password"
                    required
                    type="password"
                    autoComplete="new-password"
                    placeholder={copy.auth.resetPasswordPlaceholder}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    aria-invalid={passwordHint ? "true" : undefined}
                    aria-describedby={passwordHint ? "password-hint" : undefined}
                  />
                  {passwordHint && (
                    <p id="password-hint" className="text-xs text-destructive">
                      {passwordHint}
                    </p>
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
                    aria-describedby={mismatch ? "confirmation-hint" : undefined}
                  />
                  {mismatch && (
                    <p id="confirmation-hint" className="text-xs text-destructive">
                      {copy.auth.resetPasswordMismatch}
                    </p>
                  )}
                </div>

                <Button type="submit" className="w-full" size="lg" disabled={!canSubmit}>
                  {state === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {copy.auth.submitting}
                    </>
                  ) : (
                    <>
                      {copy.auth.resetPasswordSubmit}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>

                {state === "error" && (
                  <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive animate-fade-in">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    {errorMessage}
                  </div>
                )}

                <div className="text-center text-sm text-muted-foreground">
                  <Link
                    to="/login"
                    className="inline-flex items-center gap-1 font-medium text-kova-blue hover:underline"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    {copy.auth.backToLogin}
                  </Link>
                </div>
              </form>
            )}
    </AuthLayout>
  );
}
