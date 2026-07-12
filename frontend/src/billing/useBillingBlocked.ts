import { useCallback } from "react";
import { useNavigate } from "react-router-dom";

import { apiErrorStatus } from "@/lib/apiError";
import { copy } from "@/i18n/messages";
import { useToast } from "@/components/ui/toast";

/**
 * Shared handler for a 402 (inactive plan) thrown by a gated mutation
 * (adjust stock, create order, open shift…). Shows one toast with an "Activar
 * plan" action instead of the module's generic error, so every view reacts to
 * a blocked subscription the same way. Returns true when it handled the error
 * (the caller should stop), false otherwise so the caller falls back to its
 * normal error message.
 */
export function useBillingBlocked(): (err: unknown) => boolean {
  const { toast } = useToast();
  const navigate = useNavigate();

  return useCallback(
    (err: unknown): boolean => {
      if (apiErrorStatus(err) !== 402) return false;
      toast(copy.subscriptionInactive.body, {
        variant: "error",
        durationMs: 8000,
        action: {
          label: copy.subscriptionInactive.cta,
          onAction: () => navigate("/settings/billing"),
        },
      });
      return true;
    },
    [toast, navigate],
  );
}
