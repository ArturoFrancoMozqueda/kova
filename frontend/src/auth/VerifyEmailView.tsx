import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { copy } from "../i18n/messages";
import { verifyEmail, ApiError } from "./api";
import { Link } from "react-router-dom";
import { CheckCircle2, AlertCircle } from "lucide-react";
import { SectionSkeleton } from "@/components/ui/section-skeleton";
import { AuthLayout } from "./AuthLayout";

type State = "verifying" | "success" | "error" | "missing" | "expired";

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
      .catch((err) => {
        if (err instanceof ApiError && err.status === 400) {
          setState("expired");
          return;
        }
        setState("error");
      });
  }, [navigate, params]);

  return (
    <AuthLayout title={copy.auth.verifyEmail} contentClassName="text-center">
            {state === "verifying" && (
              <SectionSkeleton label={copy.auth.submitting} variant="form" className="py-4" />
            )}
            {state === "success" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <CheckCircle2 className="h-10 w-10 text-kova-growth" />
                <p className="font-medium text-success">{copy.auth.verified}</p>
                <p className="text-xs text-muted-foreground">{copy.auth.verifyRedirecting}</p>
              </div>
            )}
            {state === "error" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.operationError}</p>
              </div>
            )}
            {state === "expired" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.verifyExpiredTitle}</p>
                <p className="text-xs text-muted-foreground">{copy.auth.verifyExpiredBody}</p>
                <Link
                  to="/signup"
                  className="text-xs font-medium text-kova-blue hover:underline underline-offset-4"
                >
                  {copy.auth.verifyExpiredCta}
                </Link>
              </div>
            )}
            {state === "missing" && (
              <div className="flex flex-col items-center gap-3 py-4 animate-fade-in">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="font-medium text-destructive">{copy.auth.verifyMissingToken}</p>
              </div>
            )}
    </AuthLayout>
  );
}
