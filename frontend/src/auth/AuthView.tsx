import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { login, signup, verifyEmail, ApiError } from "./api";
import { passwordExceedsByteLimit } from "./passwordRules";
import { useAuth } from "./useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import {
  queueFunnelEvent,
  trackSignupValidationFailed,
  type SignupValidationField,
  type SignupValidationReason,
} from "@/telemetry/funnel";

type AuthMode = "login" | "signup";
type ActionState =
  | "idle"
  | "submitting"
  | "error"
  | "created"
  | "verified"
  | "email_in_use"
  | "verification_resent";

type SignupValidationFailure = {
  field: SignupValidationField;
  reason: SignupValidationReason;
  message: string;
};

type SignupFieldErrors = Partial<Record<SignupValidationField, string>>;

const SIGNUP_FIELD_IDS: Partial<Record<SignupValidationField, string>> = {
  business: "tenantName",
  email: "email",
  password: "password",
  terms: "acceptedTerms",
};

function signupValidationMessage(
  field: SignupValidationField,
  reason: SignupValidationReason,
): string {
  if (field === "business") {
    if (reason === "required") return copy.auth.signupBusinessRequired;
    if (reason === "too_long") return copy.auth.signupBusinessTooLong;
  }
  if (field === "email") return copy.auth.signupInvalidEmail;
  if (field === "password") {
    if (reason === "required") return copy.auth.signupPasswordRequired;
    if (reason === "too_short") return copy.auth.signupPasswordTooShort;
    if (reason === "too_long") return copy.auth.signupPasswordTooLong;
    if (reason === "weak_password") return copy.auth.signupPasswordWeak;
  }
  if (field === "terms") return copy.auth.signupTermsRequired;
  return copy.auth.signupFieldInvalid;
}

function signupValidationFailures(error: ApiError): SignupValidationFailure[] {
  try {
    const payload = JSON.parse(error.message) as {
      detail?: Array<{ loc?: unknown[]; type?: string }>;
    };
    if (!Array.isArray(payload.detail) || payload.detail.length === 0) {
      return [{
        field: "form",
        reason: "server_validation",
        message: copy.auth.operationError,
      }];
    }

    const seen = new Set<SignupValidationField>();
    return payload.detail.flatMap((detail) => {
      const backendField = detail.loc?.at(-1);
      const field: SignupValidationField =
        backendField === "tenant_name"
          ? "business"
          : backendField === "email"
            ? "email"
            : backendField === "password"
              ? "password"
              : backendField === "accepted_terms"
                ? "terms"
                : "form";
      if (seen.has(field)) return [];
      seen.add(field);

      const reason: SignupValidationReason =
        detail.type === "missing"
          ? "required"
          : detail.type === "string_too_short"
            ? "too_short"
            : detail.type === "string_too_long" || detail.type === "password_too_long"
              ? "too_long"
              : field === "email"
                ? "invalid_format"
                : field === "password" && detail.type === "value_error"
                  ? "weak_password"
                  : "server_validation";
      return [{ field, reason, message: signupValidationMessage(field, reason) }];
    });
  } catch {
    return [{
      field: "form",
      reason: "server_validation",
      message: copy.auth.operationError,
    }];
  }
}

export default function AuthView({ mode }: { mode: AuthMode }) {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { refresh } = useAuth();
  const [email, setEmail] = useState(
    mode === "login" ? (searchParams.get("email") ?? "") : "",
  );

  useEffect(() => {
    if (mode === "login") {
      const prefill = searchParams.get("email");
      if (prefill) setEmail(prefill);
    }
  }, [mode, searchParams]);
  const [password, setPassword] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [verificationToken, setVerificationToken] = useState("");
  const [state, setState] = useState<ActionState>("idle");
  const [errorMessage, setErrorMessage] = useState<string>(copy.auth.operationError);
  const [signupFieldErrors, setSignupFieldErrors] = useState<SignupFieldErrors>({});
  // Cooldown before the verification email can be resent, so a nervous user
  // can't hammer the endpoint (and hit the rate limiter).
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const id = window.setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendCountdown]);

  const reportClientValidation = (event: FormEvent<HTMLFormElement>) => {
    if (mode !== "signup") return;
    const input = event.target as HTMLInputElement;
    const field: SignupValidationField =
      input.id === "tenantName"
        ? "business"
        : input.id === "email"
          ? "email"
          : input.id === "password"
            ? "password"
            : input.id === "acceptedTerms"
              ? "terms"
              : "form";
    const reason: SignupValidationReason = input.validity.valueMissing
      ? field === "terms"
        ? "not_accepted"
        : "required"
      : input.validity.typeMismatch
        ? "invalid_format"
        : input.validity.tooShort
          ? "too_short"
          : input.validity.tooLong
            ? "too_long"
            : field === "password" && input.validity.patternMismatch
              ? "weak_password"
              : "server_validation";
    void trackSignupValidationFailed(field, reason);
  };

  const clearSignupFieldError = (field: SignupValidationField) => {
    setSignupFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const applySignupValidationFailures = (error: ApiError) => {
    const failures = signupValidationFailures(error);
    const fieldErrors: SignupFieldErrors = {};
    failures.forEach((failure) => {
      void trackSignupValidationFailed(failure.field, failure.reason);
      if (failure.field !== "form") fieldErrors[failure.field] = failure.message;
    });
    setSignupFieldErrors(fieldErrors);
    setErrorMessage(
      failures.some((failure) => failure.field === "form")
        ? copy.auth.operationError
        : copy.auth.signupValidationSummary,
    );
    setState("error");

    const firstFieldId = failures
      .map((failure) => SIGNUP_FIELD_IDS[failure.field])
      .find(Boolean);
    if (firstFieldId) document.getElementById(firstFieldId)?.focus();
  };

  /** Sign in with the credentials just typed and land in the product.
   *
   * Returns false instead of throwing when the sign-in does not go through, so
   * each signup branch can fall back to its own explanatory screen. The password
   * is validated by `login` itself — this never bypasses authentication, it only
   * removes the inbox round-trip between creating an account and using it. */
  const enterProduct = async (): Promise<boolean> => {
    try {
      await login({ email, password });
      const next = await refresh();
      queueFunnelEvent("login");
      const role = next.status === "authenticated" ? next.user.role : "";
      navigate(role === "owner" || role === "manager" ? "/dashboard" : "/register");
      return true;
    } catch {
      return false;
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (mode === "signup" && passwordExceedsByteLimit(password)) {
      setSignupFieldErrors({ password: copy.auth.signupPasswordTooLong });
      setErrorMessage(copy.auth.signupValidationSummary);
      setState("error");
      void trackSignupValidationFailed("password", "too_long");
      document.getElementById("password")?.focus();
      return;
    }
    setSignupFieldErrors({});
    setState("submitting");
    try {
      if (mode === "login") {
        await login({ email, password });
        const next = await refresh();
        // Queue until AppShell mounts authenticated — fills the funnel's login rung.
        queueFunnelEvent("login");
        const role = next.status === "authenticated" ? next.user.role : "";
        navigate(role === "owner" || role === "manager" ? "/dashboard" : "/register");
        return;
      }
      const response = await signup({
        email,
        password,
        tenant_name: tenantName,
        accepted_terms: acceptedTerms,
      });
      if (response.reason === "email_in_use") {
        setState("email_in_use");
        return;
      }
      if (response.reason === "verification_resent") {
        // Someone who signed up before, never confirmed, and came back. This is
        // the case the old flow trapped hardest: it resent an email they had
        // already failed to receive once and left them on this screen forever.
        // They typed a password, so try it — `login` verifies it, which is why
        // attempting here cannot let anyone into an account that is not theirs.
        setVerificationToken(response.dev_verification_token ?? "");
        setResendCountdown(30);
        if (await enterProduct()) return;
        // Wrong password for that address (or login unavailable): the resent
        // email is genuinely the only way forward, so say so.
        setState("verification_resent");
        return;
      }
      // `signup_completed` is recorded server-side inside the signup request —
      // the browser no longer asserts its own conversion.
      setVerificationToken(response.dev_verification_token ?? "");
      setResendCountdown(30);
      // The account exists and the person just proved they know the password.
      // Let them into the product now and ask for email verification from
      // inside, where a banner can nag without blocking; verification is still
      // required before any paid action. Waiting on an inbox at this exact
      // moment was costing a third of all signups.
      if (await enterProduct()) return;
      // Auto-login is a convenience, not a guarantee. If it fails (rate limit,
      // transient network) fall back to the explicit "check your email" screen
      // rather than losing the fact that the account was created.
      setState("created");
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setErrorMessage(copy.auth.loginInvalidCredentials);
        } else if (err.status === 429) {
          setErrorMessage(copy.auth.loginRateLimited);
        } else if (err.status === 422) {
          if (mode === "signup") {
            applySignupValidationFailures(err);
            return;
          }
          // Malformed email (and other unprocessable input) — a clear "check the
          // email" beats the generic "something went wrong".
          setErrorMessage(copy.auth.signupInvalidEmail);
        } else {
          setErrorMessage(copy.auth.operationError);
        }
      } else {
        setErrorMessage(copy.auth.operationError);
      }
      setState("error");
    }
  };

  const resendVerification = async () => {
    if (resendCountdown > 0 || mode !== "signup") return;
    try {
      const response = await signup({
        email,
        password,
        tenant_name: tenantName,
        accepted_terms: acceptedTerms,
      });
      setVerificationToken(response.dev_verification_token ?? "");
      setState("verification_resent");
      setResendCountdown(30);
    } catch (err) {
      if (err instanceof ApiError && err.status === 422) {
        applySignupValidationFailures(err);
        return;
      }
      setErrorMessage(
        err instanceof ApiError && err.status === 429
          ? copy.auth.loginRateLimited
          : copy.auth.operationError,
      );
      setState("error");
    }
  };

  const verify = async () => {
    setState("submitting");
    try {
      await verifyEmail(verificationToken);
      setState("verified");
    } catch {
      setState("error");
    }
  };

  const hasError = state === "error";
  const loginHasError = mode === "login" && hasError;

  return (
    <AuthLayout
      title={mode === "login" ? copy.auth.loginTitle : copy.auth.signupTitle}
      subtitle={mode === "login" ? copy.auth.loginSubtitle : copy.auth.signupSubtitle}
    >
      <form
        onSubmit={(event) => void submit(event)}
        onInvalid={reportClientValidation}
        className="space-y-4"
      >
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="tenantName">{copy.auth.tenantName}</Label>
                  <Input
                    id="tenantName"
                    required
                    maxLength={120}
                    autoComplete="organization"
                    placeholder={copy.auth.tenantNamePlaceholder}
                    value={tenantName}
                    onChange={(event) => {
                      setTenantName(event.target.value);
                      clearSignupFieldError("business");
                    }}
                    aria-invalid={Boolean(signupFieldErrors.business) || undefined}
                    aria-describedby={signupFieldErrors.business ? "tenantName-error" : undefined}
                  />
                  {signupFieldErrors.business && (
                    <p id="tenantName-error" className="text-xs text-destructive">
                      {signupFieldErrors.business}
                    </p>
                  )}
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">{copy.auth.email}</Label>
                <Input
                  id="email"
                  required
                  type="email"
                  autoComplete="email"
                  placeholder={copy.auth.emailPlaceholder}
                  value={email}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    if (mode === "signup") clearSignupFieldError("email");
                  }}
                  aria-invalid={loginHasError || Boolean(signupFieldErrors.email) || undefined}
                  aria-describedby={
                    loginHasError
                      ? "auth-error"
                      : signupFieldErrors.email
                        ? "email-error"
                        : undefined
                  }
                />
                {mode === "signup" && signupFieldErrors.email && (
                  <p id="email-error" className="text-xs text-destructive">
                    {signupFieldErrors.email}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label htmlFor="password">{copy.auth.password}</Label>
                  {mode === "login" && (
                    <Link
                      to="/forgot-password"
                      className="text-xs font-medium text-kova-blue hover:underline underline-offset-4"
                    >
                      {copy.auth.forgotPassword}
                    </Link>
                  )}
                </div>
                <Input
                  id="password"
                  required
                  type="password"
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder={mode === "login" ? copy.auth.passwordPlaceholderLogin : copy.auth.passwordPlaceholderSignup}
                  value={password}
                  minLength={mode === "signup" ? 8 : undefined}
                  maxLength={mode === "signup" ? 128 : undefined}
                  pattern={mode === "signup" ? "(?=.*[A-Za-z])(?=.*[0-9]).{8,128}" : undefined}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    if (mode === "signup") clearSignupFieldError("password");
                  }}
                  aria-invalid={loginHasError || Boolean(signupFieldErrors.password) || undefined}
                  aria-describedby={
                    loginHasError
                      ? "auth-error"
                      : mode === "signup"
                        ? ["password-requirements", signupFieldErrors.password ? "password-error" : ""]
                            .filter(Boolean)
                            .join(" ")
                        : undefined
                  }
                />
                {mode === "signup" && (
                  <p id="password-requirements" className="text-xs text-muted-foreground">
                    {copy.auth.signupPasswordRequirements}
                  </p>
                )}
                {mode === "signup" && signupFieldErrors.password && (
                  <p id="password-error" className="text-xs text-destructive">
                    {signupFieldErrors.password}
                  </p>
                )}
              </div>

              {mode === "signup" && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
                  <label className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground cursor-pointer">
                    <input
                      id="acceptedTerms"
                      type="checkbox"
                      required
                      checked={acceptedTerms}
                      onChange={(event) => {
                        setAcceptedTerms(event.target.checked);
                        clearSignupFieldError("terms");
                      }}
                      aria-invalid={Boolean(signupFieldErrors.terms) || undefined}
                      aria-describedby={signupFieldErrors.terms ? "acceptedTerms-error" : undefined}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-[0.5px] border-kova-border accent-kova-blue cursor-pointer"
                    />
                    <span>
                      {copy.auth.acceptTermsPrefix}{" "}
                      <a
                        href="/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-kova-blue hover:underline"
                      >
                        {copy.auth.privacy}
                      </a>
                      {" "}y{" "}
                      <a
                        href="/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-kova-blue hover:underline"
                      >
                        {copy.auth.terms}
                      </a>
                      {" "}{copy.auth.acceptTermsOfKova}{" "}
                      {copy.auth.signupSecurityPrefix}{" "}
                      <a
                        href="/cookies"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-medium text-kova-blue hover:underline"
                      >
                        {copy.auth.signupSecurityLink}
                      </a>
                      .
                    </span>
                  </label>
                  {signupFieldErrors.terms && (
                    <p id="acceptedTerms-error" className="mt-1 text-xs text-destructive">
                      {signupFieldErrors.terms}
                    </p>
                  )}
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={
                  state === "submitting" || (mode === "signup" && !acceptedTerms)
                }
              >
                {state === "submitting" ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    {copy.auth.submitting}
                  </>
                ) : (
                  <>
                    {mode === "login" ? copy.auth.login : copy.auth.signup}
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
              {mode === "signup" && (
                <p className="text-center text-xs text-muted-foreground">
                  {copy.auth.signupTrustLine}
                </p>
              )}
            </form>

            {state === "error" && (
              <div
                role="alert"
                id="auth-error"
                className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive animate-fade-in"
              >
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errorMessage}
              </div>
            )}

            {state === "created" && (
              <div className="mt-4 space-y-3 animate-fade-in">
                <div
                  role="status"
                  className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {verificationToken ? copy.auth.devVerifyReady : copy.auth.checkEmail}
                </div>
                {verificationToken && (
                  <div className="space-y-2">
                    <Label htmlFor="verificationToken">{copy.auth.verificationToken}</Label>
                    <Input
                      id="verificationToken"
                      value={verificationToken}
                      onChange={(event) => setVerificationToken(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void verify()}
                      disabled={!verificationToken}
                      className="w-full"
                    >
                      {copy.auth.verifyEmail}
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void resendVerification()}
                  disabled={resendCountdown > 0}
                  className="w-full text-sm"
                >
                  {resendCountdown > 0
                    ? copy.auth.resendVerificationCountdown(resendCountdown)
                    : copy.auth.resendVerification}
                </Button>
              </div>
            )}

            {state === "verified" && (
              <div
                role="status"
                className="mt-4 flex items-center gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success animate-fade-in"
              >
                <CheckCircle2 className="h-4 w-4 shrink-0" />
                {copy.auth.verified}
              </div>
            )}

            {state === "email_in_use" && (
              <div className="mt-4 space-y-3 animate-fade-in">
                <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm">
                  <p className="font-medium text-foreground">
                    {copy.auth.signupEmailInUseTitle}
                  </p>
                  <p className="mt-1 text-muted-foreground">
                    {copy.auth.signupEmailInUseBody}
                  </p>
                </div>
                <div className="flex flex-col gap-2">
                  <Button
                    type="button"
                    className="w-full"
                    size="lg"
                    onClick={() =>
                      navigate(`/login?email=${encodeURIComponent(email)}`)
                    }
                  >
                    {copy.auth.signupEmailInUseCta}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                  <Link
                    to="/forgot-password"
                    className="text-center text-xs font-medium text-kova-blue hover:underline underline-offset-4"
                  >
                    {copy.auth.signupEmailInUseForgot}
                  </Link>
                </div>
              </div>
            )}

            {state === "verification_resent" && (
              <div className="mt-4 space-y-3 animate-fade-in">
                <div
                  role="status"
                  className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium">
                      {copy.auth.signupVerificationResentTitle}
                    </p>
                    <p className="mt-1">
                      {copy.auth.signupVerificationResentBody(email)}
                    </p>
                  </div>
                </div>
                {verificationToken && (
                  <div className="space-y-2">
                    <Label htmlFor="verificationToken">{copy.auth.verificationToken}</Label>
                    <Input
                      id="verificationToken"
                      value={verificationToken}
                      onChange={(event) => setVerificationToken(event.target.value)}
                    />
                    <Button
                      variant="outline"
                      onClick={() => void verify()}
                      disabled={!verificationToken}
                      className="w-full"
                    >
                      {copy.auth.verifyEmail}
                    </Button>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => void resendVerification()}
                  disabled={resendCountdown > 0}
                  className="w-full text-sm"
                >
                  {resendCountdown > 0
                    ? copy.auth.resendVerificationCountdown(resendCountdown)
                    : copy.auth.resendVerification}
                </Button>
              </div>
            )}

            <div className="mt-6 text-center text-sm text-muted-foreground">
              {mode === "login" ? copy.auth.needAccountPrompt : copy.auth.haveAccountPrompt}{" "}
              <Link
                to={mode === "login" ? "/signup" : "/login"}
                className="font-medium text-kova-blue hover:underline underline-offset-4"
              >
                {mode === "login" ? copy.auth.needAccount : copy.auth.haveAccount}
              </Link>
            </div>
    </AuthLayout>
  );
}
