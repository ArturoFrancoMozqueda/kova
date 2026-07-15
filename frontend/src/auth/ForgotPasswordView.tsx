import { FormEvent, useState } from "react";
import { Link } from "react-router-dom";
import { copy } from "../i18n/messages";
import { requestPasswordReset } from "./api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CheckCircle2, Loader2, ArrowRight, ArrowLeft } from "lucide-react";
import { AuthLayout } from "./AuthLayout";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type State = "idle" | "submitting" | "sent";

export default function ForgotPasswordView() {
  useDocumentTitle(copy.documentTitles.forgotPassword);
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");
  const [devToken, setDevToken] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setState("submitting");
    // The backend always returns 200 with the generic "if the email exists…"
    // message to avoid account enumeration. In local/dev environments it
    // surfaces the reset token so we can complete the flow without a mailbox.
    try {
      const response = await requestPasswordReset(email);
      setDevToken(response.dev_reset_token ?? null);
    } catch {
      // Mirror OPSEC: never reveal failures to the user — we always show the
      // generic "sent" message.
    } finally {
      setState("sent");
    }
  };

  return (
    <AuthLayout title={copy.auth.forgotPasswordTitle} subtitle={copy.auth.forgotPasswordSubtitle}>
            {state === "sent" ? (
              <div className="space-y-4">
                <div className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-success">
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
              <form onSubmit={(event) => void submit(event)} className="space-y-4">
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
