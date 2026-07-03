import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { resolveApiErrorMessage } from "@/lib/apiError";
import { createNote } from "../api";
import { formatDateTime } from "../format";
import { opsKeys } from "../hooks";
import type { OpsNote } from "../types";

export function IncidentNotes({
  incidentKey,
  source,
  externalId,
  notes,
}: {
  incidentKey: string;
  source: string;
  externalId: string;
  notes: OpsNote[];
}) {
  const [body, setBody] = useState("");
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const mutation = useMutation({
    mutationFn: () =>
      createNote({
        entity_type: "incident",
        entity_source: source,
        entity_external_id: externalId,
        body: body.trim(),
      }),
    onSuccess: () => {
      setBody("");
      toast("Nota agregada", "success");
      void queryClient.invalidateQueries({ queryKey: opsKeys.incident(incidentKey) });
    },
    onError: (error) => toast(resolveApiErrorMessage(error, "No se pudo guardar la nota"), "error"),
  });

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-medium text-kova-ink">Notas de triage</h3>
      <div className="space-y-2">
        {notes.length === 0 ? (
          <p className="text-sm text-kova-muted">Sin notas todavía.</p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="rounded-lg border border-kova-border bg-white p-3">
              <div className="flex items-center justify-between text-xs text-kova-muted">
                <span>{note.author_email}</span>
                <span>{formatDateTime(note.created_at)}</span>
              </div>
              <p className="mt-1 text-sm text-kova-ink">{note.body}</p>
            </div>
          ))
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) mutation.mutate();
        }}
        className="space-y-2"
      >
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Agregar una nota…"
          rows={3}
          className="w-full rounded-kova-md border-[0.5px] border-kova-border bg-transparent p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-kova-blue"
        />
        <Button type="submit" size="sm" disabled={!body.trim() || mutation.isPending}>
          {mutation.isPending ? "Guardando…" : "Agregar nota"}
        </Button>
      </form>
    </div>
  );
}
