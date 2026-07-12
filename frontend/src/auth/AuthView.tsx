import { FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { login, signup, verifyEmail, ApiError } from "./api";
import { useAuth } from "./useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { AlertCircle, CheckCircle2, Loader2, ArrowRight } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";
import { queueFunnelEvent } from "@/telemetry/funnel";

type AuthMode = "login" | "signup";
type ActionState =
  | "idle"
  | "submitting"
  | "error"
  | "created"
  | "verified"
  | "email_in_use"
  | "verification_resent";

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
  // Cooldown before the verification email can be resent, so a nervous user
  // can't hammer the endpoint (and hit the rate limiter).
  const [resendCountdown, setResendCountdown] = useState(0);

  useEffect(() => {
    if (resendCountdown <= 0) return;
    const id = window.setTimeout(() => setResendCountdown((s) => s - 1), 1000);
    return () => window.clearTimeout(id);
  }, [resendCountdown]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("submitting");
    try {
      if (mode === "login") {
        await login({ email, password });
        const next = await refresh();
        // Queued (like signup_completed) so it flushes once AppShell mounts
        // authenticated — fills the funnel's `login` rung.
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
        setVerificationToken(response.dev_verification_token ?? "");
        setState("verification_resent");
        setResendCountdown(30);
        return;
      }
      queueFunnelEvent("signup_completed", {
        tenant_id: response.tenant_id,
      });
      setVerificationToken(response.dev_verification_token ?? "");
      setState("created");
      setResendCountdown(30);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 401 || err.status === 403) {
          setErrorMessage(copy.auth.loginInvalidCredentials);
        } else if (err.status === 429) {
          setErrorMessage(copy.auth.loginRateLimited);
        } else if (err.status === 422) {
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

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 p-4">
      <div className="w-full max-w-md animate-fade-in">
        {/* Brand header */}
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <LogoMark size={48} circuitColor="var(--kova-ink)" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">
            {mode === "login" ? copy.auth.loginTitle : copy.auth.signupTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {mode === "login" ? copy.auth.loginSubtitle : copy.auth.signupSubtitle}
          </p>
        </div>

        <Card className="shadow-lg border-border/50">
          <CardContent className="p-6">
            <form onSubmit={(event) => void submit(event)} className="space-y-4">
              {mode === "signup" && (
                <div className="space-y-2">
                  <Label htmlFor="tenantName">{copy.auth.tenantName}</Label>
                  <Input
                    id="tenantName"
                    required
                    autoComplete="organization"
                    placeholder={copy.auth.tenantNamePlaceholder}
                    value={tenantName}
                    onChange={(event) => setTenantName(event.target.value)}
                  />
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
                  onChange={(event) => setEmail(event.target.value)}
                />
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
                  onChange={(event) => setPassword(event.target.value)}
                />
              </div>

              {mode === "signup" && (
                <div className="rounded-lg border bg-muted/40 px-3 py-2.5">
                  <label className="flex items-start gap-2.5 text-xs leading-5 text-muted-foreground cursor-pointer">
                    <input
                      id="acceptedTerms"
                      type="checkbox"
                      required
                      checked={acceptedTerms}
                      onChange={(event) => setAcceptedTerms(event.target.checked)}
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
            </form>

            {state === "error" && (
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5 text-sm text-destructive animate-fade-in">
                <AlertCircle className="h-4 w-4 shrink-0" />
                {errorMessage}
              </div>
            )}

            {state === "created" && (
              <div className="mt-4 space-y-3 animate-fade-in">
                <div className="flex items-center gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success">
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
              <div className="mt-4 flex items-center gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success animate-fade-in">
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
                <div className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success">
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
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
