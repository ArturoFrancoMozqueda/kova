import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { requestPasswordReset } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertCircle, CheckCircle2, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type State = "idle" | "submitting" | "sent" | "error";

export default function ForgotPasswordView() {
  useDocumentTitle(copy.documentTitles.forgotPassword);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [devToken, setDevToken] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setDevToken(null);
    // Accepted requests stay generic for existing and unknown accounts.
    // Transport/service failures need a retry; they do not reveal account state.
    try {
      const response = await requestPasswordReset(email.trim());
      setDevToken(response.dev_reset_token ?? null);
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <AuthLayout title={copy.auth.forgotPasswordTitle} subtitle={copy.auth.forgotPasswordSubtitle}>
            {state === "sent" ? (
              <div className="space-y-4">
                <div role="status" className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{copy.auth.forgotPasswordSent}</span>
                </div>
                {devToken && (
                  <div className="rounded-lg border border-dashed border-warning/40 bg-warning/5 px-3 py-2.5 text-xs space-y-1.5">
                    <p className="font-semibold text-warning-foreground">{copy.auth.devResetReady}</p>
                    <p className="break-all text-[11px] text-muted-foreground">{devToken}</p>
                    <Link
                      to={`/reset-password?token=${encodeURIComponent(devToken)}`}
                      className="inline-flex items-center gap-1 font-medium text-kova-blue hover:underline"
                    >
                      {copy.auth.devResetOpen}
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                )}
                <Link
                  to="/login"
                  className="inline-flex items-center gap-1 text-sm font-medium text-kova-blue hover:underline"
                >
                  <ArrowLeft className="h-4 w-4" />
                  {copy.auth.backToLogin}
                </Link>
              </div>
            ) : (
              <form onSubmit={(event) => void submit(event)} aria-busy={state === "submitting"} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">{copy.auth.email}</Label>
                  <Input
                    id="email"
                    required
                    type="email"
                    autoComplete="email"
                    placeholder={copy.auth.emailPlaceholder}
                    value={email}
                    disabled={state === "submitting"}
                    onChange={(event) => setEmail(event.target.value)}
                  />
                </div>
                <Button type="submit" className="w-full" size="lg" disabled={state === "submitting"}>
                  {state === "submitting" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {copy.auth.submitting}
                    </>
                  ) : (
                    <>
                      {copy.auth.forgotPasswordSubmit}
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </Button>
                {state === "error" && (
                  <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{copy.auth.forgotPasswordError}</span>
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
