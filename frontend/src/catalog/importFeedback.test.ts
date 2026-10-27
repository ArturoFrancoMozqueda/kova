import { expect, it } from "vitest";
import { catalogImportFeedback } from "./importFeedback";
it("explains inventory columns in business terms while preserving the needed correction", () => {
  expect(catalogImportFeedback("activa control_inventario para cargar stock_inicial")).toBe("Activa el control de inventario para importar las existencias iniciales.");
  expect(catalogImportFeedback("umbral_stock debe ser un número entero")).toBe("El mínimo de existencias debe ser un número entero");
  expect(catalogImportFeedback("codigo_barras ya existe o está repetido")).toBe("El código de barras ya existe o está repetido");
  expect(catalogImportFeedback("sku está repetido en el archivo")).toBe("El SKU está repetido en el archivo");
});
it("never turns diagnostics into import instructions", () => {
  expect(catalogImportFeedback("SELECT tenant_id FROM products")).toBe("Revisa los datos de este producto en la plantilla.");
  expect(catalogImportFeedback("<html>Internal Server Error</html>")).toBe("Revisa los datos de este producto en la plantilla.");
});
