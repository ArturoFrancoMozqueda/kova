import { useState } from "react";
import { MailWarning, Check, Loader2 } from "lucide-react";
import { copy } from "@/i18n/messages";
import { useOptionalAuth } from "@/auth/useAuth";
import { resendVerificationEmail } from "@/auth/api";

type SendState = "idle" | "sending" | "sent" | "error";

/**
 * Persistent nudge for accounts that can use Kova but have not confirmed their
 * address.
 *
 * Sign-in no longer waits on email verification, so this banner carries the
 * obligation that the login wall used to: it stays visible (no dismiss) until
 * the address is confirmed, and it is the only place the person can ask for
 * another email without signing out. Paid actions remain blocked server-side
 * until then.
 */
export function EmailVerificationBanner() {
  const auth = useOptionalAuth();
  const [sendState, setSendState] = useState<SendState>("idle");

  const state = auth?.state;
  if (state?.status !== "authenticated") return null;
  // `email_verified` is optional in the response type: an older cached session
  // shape should not nag someone who already verified.
  if (state.user.email_verified !== false) return null;

  const resend = async () => {
    setSendState("sending");
    try {
      await resendVerificationEmail();
      setSendState("sent");
    } catch {
      setSendState("error");
    }
  };

  return (
    <div
      role="status"
      data-testid="email-verification-banner"
      className="mx-4 mt-4 flex flex-col gap-2 rounded-[var(--radius-lg)] border border-warning/40 bg-warning/10 px-3 py-2.5 text-warning-foreground sm:flex-row sm:items-center sm:justify-between sm:px-4 sm:py-3"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 shrink-0">
          <MailWarning className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{copy.emailVerification.title}</p>
          <p className="hidden text-xs opacity-90 sm:block">
            {copy.emailVerification.body(state.user.email)}
          </p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
        {sendState === "sent" ? (
          <span className="flex items-center gap-1.5 text-xs font-semibold">
            <Check className="h-4 w-4" />
            {copy.emailVerification.sent}
          </span>
        ) : (
          <button
            type="button"
            onClick={resend}
            disabled={sendState === "sending"}
            className="flex items-center gap-1.5 rounded-[var(--radius-md)] border border-current/30 bg-white/60 px-3 py-1.5 text-xs font-semibold hover:bg-white disabled:opacity-60"
          >
            {sendState === "sending" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {sendState === "error"
              ? copy.emailVerification.retryCta
              : copy.emailVerification.resendCta}
          </button>
        )}
      </div>
    </div>
  );
}
