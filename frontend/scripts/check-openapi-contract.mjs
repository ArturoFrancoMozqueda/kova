import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.resolve(here, "../../specs/openapi.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const errors = [];

function expectStatus(route, method, status) {
  if (!contract.paths?.[route]?.[method]?.responses?.[status]) {
    errors.push(`${method.toUpperCase()} ${route} debe responder ${status}`);
  }
}

function expectProperties(schemaName, properties) {
  const schema = contract.components?.schemas?.[schemaName];
  if (!schema) {
    errors.push(`Falta schema ${schemaName}`);
    return;
  }
  for (const property of properties) {
    if (!schema.properties?.[property]) errors.push(`${schemaName}.${property} no existe`);
  }
}

// DTOs consumed directly by auth, catálogo, venta y settings. This deliberately
// checks only the stable boundary the SPA relies on; the complete schema diff is
// enforced by backend/scripts/export_openapi.py --check.
expectProperties("SessionProbeResponse", [
  "authenticated", "tenant_id", "tenant_name", "user", "feature_flags",
]);
expectProperties("ProductResponse", [
  "id", "tenant_id", "name", "price_amount", "cost_price", "is_active", "modifier_groups",
]);
expectProperties("OrderResponse", [
  "id", "tenant_id", "status", "subtotal_amount", "total_amount", "items", "payments",
]);
expectProperties("BusinessProfileResponse", [
  "tenant_id", "public_name", "timezone", "locale", "currency",
]);
expectProperties("OverviewResponse", [
  "generated_at", "health", "growth", "money", "operations", "risk",
]);
expectProperties("TenantListResponse", ["generated_at", "items", "total"]);
expectProperties("TraceResponse", ["generated_at", "query", "timeline", "sources_queried"]);
expectProperties("OpsMfaStatusResponse", [
  "enrolled", "step_up_valid", "recovery_codes_remaining",
]);
expectProperties("OpsMfaSetupResponse", ["secret", "qr_png_data_url"]);

expectStatus("/api/v1/auth/signup", "post", "200");
expectStatus("/api/v1/auth/login", "post", "200");
expectStatus("/api/v1/auth/session", "get", "200");
expectStatus("/api/v1/catalog/products", "get", "200");
expectStatus("/api/v1/catalog/products", "post", "201");
expectStatus("/api/v1/orders", "post", "201");
expectStatus("/api/v1/settings/business-profile", "get", "200");
expectStatus("/api/v1/internal/ops/me", "get", "200");
expectStatus("/api/v1/internal/ops/overview", "get", "200");
expectStatus("/api/v1/internal/ops/tenants", "get", "200");
expectStatus("/api/v1/internal/ops/trace", "get", "200");
expectStatus("/api/v1/internal/ops/notes", "post", "201");
expectStatus("/api/v1/internal/ops/mfa/status", "get", "200");
expectStatus("/api/v1/internal/ops/mfa/setup", "post", "200");
expectStatus("/api/v1/internal/ops/mfa/confirm", "post", "200");
expectStatus("/api/v1/internal/ops/mfa/verify", "post", "200");

if (errors.length) {
  console.error(`Contrato frontend/backend incompatible:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}

console.log("Contrato OpenAPI crítico compatible con los DTO del frontend.");
