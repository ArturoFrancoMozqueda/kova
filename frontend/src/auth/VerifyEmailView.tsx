import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { verifyEmail, ApiError } from "./api";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { AuthLayout } from "./AuthLayout";
import { Button } from "@/components/ui/button";
import { useDocumentTitle } from "@/hooks/useDocumentTitle";

type State = "verifying" | "success" | "error" | "missing" | "expired";

export default function VerifyEmailView() {
  const [params] = useSearchParams();
  const token = params.get("token")?.trim() ?? "";
  return <Verification key={token} token={token} />;
}

function Verification({ token }: { token: string }) {
  useDocumentTitle(copy.auth.verifyEmail);
  const navigate = useNavigate();
  const [state, setState] = useState<State>(token ? "verifying" : "missing");
  const [attempt, setAttempt] = useState(0);
  // Reuse the in-flight request during StrictMode effect replay: a verification
  // link is single-use. Keep it only in this mounted link's memory.
  const request = useRef<ReturnType<typeof verifyEmail> | null>(null);

  useEffect(() => {
    if (!token) return;
    let active = true;
    request.current ??= verifyEmail(token);
    request.current
      .then(() => {
        if (!active) return;
        setState("success");
      })
      .catch((err) => {
        if (!active) return;
        if (err instanceof ApiError && err.status === 400) {
          setState("expired");
          return;
        }
        setState("error");
      });
    return () => { active = false; };
  }, [token, attempt]);

  useEffect(() => {
    if (state !== "success") return;
    const timeout = window.setTimeout(() => navigate("/login", { replace: true }), 2500);
    return () => window.clearTimeout(timeout);
  }, [state, navigate]);

  return (
    <AuthLayout title={copy.auth.verifyEmail} contentClassName="text-center">
            {state === "verifying" && (
              <SectionSkeleton label={copy.auth.submitting} variant="notice" className="py-4" />
            )}
            {state === "success" && (
              <div role="status" className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <CheckCircle2 className="h-10 w-10 text-kova-growth" />
                <p className="font-medium text-success">{copy.auth.verified}</p>
                <p className="text-xs text-muted-foreground">{copy.auth.verifyRedirecting}</p>
              </div>
            )}
            {state === "error" && (
              <div role="alert" className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.operationError}</p>
                <Button onClick={() => {
                  request.current = null;
                  setState("verifying");
                  setAttempt(value => value + 1);
                }}>{copy.auth.verifyRetry}</Button>
              </div>
            )}
            {state === "expired" && (
              <div role="alert" className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.verifyExpiredTitle}</p>
                <p className="text-xs text-muted-foreground">{copy.auth.verifyExpiredBody}</p>
                <Link
                  to="/login"
                  className="text-xs font-medium text-kova-blue hover:underline underline-offset-4"
                >
                  {copy.auth.verifyExpiredCta}
                </Link>
              </div>
            )}
            {state === "missing" && (
              <div role="alert" className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.verifyMissingToken}</p>
              </div>
            )}
    </AuthLayout>
  );
}
