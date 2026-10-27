import { safeUserMessage } from "@/lib/apiError";

const instructions: Record<string, string> = {
  "activa control_inventario para cargar stock_inicial": "Activa el control de inventario para importar las existencias iniciales.",
  "activa control_inventario para definir umbral_stock": "Activa el control de inventario para definir el mínimo de existencias.",
};
const fieldLabels: Record<string, string> = {
  nombre: "El nombre", sku: "El SKU", precio: "El precio", costo: "El costo", categoria: "La categoría",
  control_inventario: "El control de inventario", stock_inicial: "Las existencias iniciales", umbral_stock: "El mínimo de existencias", codigo_barras: "El código de barras",
};
export function catalogImportFeedback(message: string) {
  const instruction = instructions[message];
  if (instruction) return instruction;
  const human = message.replace(/^(nombre|sku|precio|costo|categoria|control_inventario|stock_inicial|umbral_stock|codigo_barras)\b/, field => fieldLabels[field]);
  return safeUserMessage(human, "Revisa los datos de este producto en la plantilla.");
}
