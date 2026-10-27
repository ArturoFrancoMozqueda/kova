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

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    // Accepted requests stay generic for existing and unknown accounts.
    // Transport/service failures need a retry; they do not reveal account state.
    try {
      await requestPasswordReset(email.trim());
      setState("sent");
    } catch {
      setState("error");
    }
  };

  return (
    <AuthLayout title={copy.auth.forgotPasswordTitle} subtitle={copy.auth.forgotPasswordSubtitle}>
            {state === "sent" ? (
              <div className="space-y-4">
                <div role="status" className="flex items-start gap-2 rounded-lg bg-success/10 border border-success/20 px-3 py-2.5 text-sm text-foreground [&>svg]:text-success">
                  <CheckCircle2 className="h-4 w-4 mt-0.5 shrink-0" />
                  <span>{copy.auth.forgotPasswordSent}</span>
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
                  <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-foreground [&>svg]:text-destructive">
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
