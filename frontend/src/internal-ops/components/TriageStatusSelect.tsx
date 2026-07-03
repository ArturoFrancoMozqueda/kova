import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { updateTriage } from "../api";
import { opsCopy } from "../copy";
import { opsKeys } from "../hooks";
import type { TriageStatus } from "../types";

const OPTIONS: TriageStatus[] = ["new", "acknowledged", "investigating", "resolved", "ignored"];

export function TriageStatusSelect({ incidentKey, current }: { incidentKey: string; current: TriageStatus }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: (status: TriageStatus) => updateTriage(incidentKey, { triage_status: status }),
    onSuccess: () => {
      toast("Triage actualizado", "success");
      void queryClient.invalidateQueries({ queryKey: opsKeys.incident(incidentKey) });
      void queryClient.invalidateQueries({ queryKey: ["ops", "incidents"] });
    },
    onError: () => toast("No se pudo actualizar el triage", "error"),
  });

  return (
    <Select
      value={current}
      disabled={mutation.isPending}
      onChange={(e) => mutation.mutate(e.target.value as TriageStatus)}
      aria-label="Estado de triage"
    >
      {OPTIONS.map((status) => (
        <option key={status} value={status}>
          {opsCopy.triage[status]}
        </option>
      ))}
    </Select>
  );
}
