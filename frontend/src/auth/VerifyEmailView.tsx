import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { verifyEmail } from "./api";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { LogoMark } from "@/components/brand/Logo";

type State = "verifying" | "success" | "error" | "missing";

export default function VerifyEmailView() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<State>("verifying");

  useEffect(() => {
    const token = params.get("token");
    if (!token) { setState("missing"); return; }
    verifyEmail(token)
      .then(() => {
        setState("success");
        window.setTimeout(() => navigate("/login"), 2500);
      })
      .catch(() => setState("error"));
  }, [navigate, params]);

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-background via-background to-muted/40 p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="text-center mb-8">
          <div className="mb-4 flex justify-center">
            <LogoMark size={48} circuitColor="var(--kova-ink)" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">{copy.auth.verifyEmail}</h1>
        </div>

        <Card className="shadow-lg border-border/50">
          <CardContent className="p-6 text-center">
            {state === "verifying" && (
              <div className="flex flex-col items-center gap-3 py-4">
                <Loader2 className="h-8 w-8 text-kova-blue animate-spin" />
                <p className="text-muted-foreground">{copy.auth.submitting}...</p>
              </div>
            )}
            {state === "success" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <CheckCircle2 className="h-10 w-10 text-emerald-500" />
                <p className="font-medium text-emerald-800">{copy.auth.verified}</p>
                <p className="text-xs text-muted-foreground">{copy.auth.verifyRedirecting}</p>
              </div>
            )}
            {state === "error" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.operationError}</p>
              </div>
            )}
            {state === "missing" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.verifyMissingToken}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
