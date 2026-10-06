import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import type { Step } from "./api";

const fields: Record<string, [string, string, string][]> = {
  business_profile: [["public_name", "Nombre comercial", "text"], ["timezone", "Zona horaria", "text"], ["support_email", "Correo de soporte", "email"], ["support_phone", "Teléfono", "text"]],
  receipt: [["receipt_business_name", "Nombre del ticket", "text"], ["footer", "Pie del ticket", "text"], ["paper_width_mm", "Ancho del papel (58 u 80 mm)", "number"]],
  category_create: [["name", "Nombre", "text"], ["description", "Descripción", "text"]],
  category_update: [["name", "Nombre", "text"], ["description", "Descripción", "text"]],
  product_create: [["name", "Nombre", "text"], ["price_amount", "Precio MXN", "number"], ["cost_price", "Costo MXN", "number"], ["sku", "SKU", "text"]],
  product_update: [["name", "Nombre", "text"], ["price_amount", "Precio MXN", "number"], ["cost_price", "Costo MXN", "number"], ["sku", "SKU", "text"]],
  branch_create: [["name", "Nombre", "text"], ["address", "Dirección", "text"]],
  branch_update: [["name", "Nombre", "text"], ["address", "Dirección", "text"]],
  invitation: [["email", "Correo del colaborador", "email"], ["role", "Rol", "role"]],
};
const names: Record<string, string> = { business_profile: "Perfil del negocio", receipt: "Ticket", category_create: "Nueva categoría", product_create: "Nuevo producto", branch_create: "Nueva sucursal", invitation: "Invitar colaborador" };
const fieldClass = "mt-2 min-h-11 w-full rounded-kova-md border border-kova-border bg-white px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-kova-blue";

export function ConfigurationDraft({ initial, busy, onPreview, onCancel }: {
  initial?: Step[]; busy: boolean; onPreview: (steps: Step[]) => void; onCancel?: () => void;
}) {
  const [steps, setSteps] = useState<Step[]>(initial ?? [{ action: "business_profile", values: { timezone: "America/Mexico_City" } }]);
  const write = (index: number, key: string, value: string) => setSteps(current => current.map((step, i) => {
    if (i !== index) return step;
    const values = { ...step.values };
    if (value === "") delete values[key];
    else values[key] = key === "paper_width_mm" ? Number(value) : value;
    return { ...step, values };
  }));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onPreview(steps.map(({ action, resource_id, values }) => ({ action, resource_id, values })));
  };
  return <form className="space-y-4" onSubmit={submit}>
    {!initial ? <label className="block text-sm">Qué quieres configurar<select className={fieldClass} value={steps[0].action} disabled={busy} onChange={event => setSteps([{ action: event.target.value, values: event.target.value === "invitation" ? { role: "cashier" } : {} }])}>{Object.entries(names).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label> : null}
    {steps.map((step, index) => <fieldset key={index} className="space-y-3" disabled={busy}><legend className="font-medium">{names[step.action] ?? "Corregir configuración"}</legend>
      {(fields[step.action] ?? []).map(([key, label, type]) => <label key={key} className="block text-sm">{label}{type === "role" ? <select className={fieldClass} value={String(step.values[key] ?? "cashier")} onChange={event => write(index, key, event.target.value)}><option value="cashier">Cajero</option><option value="manager">Administrador</option></select> : <input className={fieldClass} type={type} step={type === "number" ? "0.01" : undefined} min={type === "number" ? "0" : undefined} maxLength={1000} value={String(step.values[key] ?? "")} onChange={event => write(index, key, event.target.value)} />}</label>)}
      {step.action === "catalog_import" ? <p className="text-sm text-kova-muted">Corrige el archivo y vuelve a cargarlo para modificar esta importación.</p> : null}
    </fieldset>)}
    <p className="text-sm text-kova-muted">Todavía no se guardará ningún cambio. Primero verás la configuración completa para revisarla.</p>
    <div className="flex flex-wrap gap-3"><Button type="submit" disabled={busy}>Preparar vista previa</Button>{onCancel ? <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>Cancelar edición</Button> : null}</div>
  </form>;
}
