# Motor de impuestos configurable

## Estado y alcance

Especificado, no implementado. V1 calcula impuestos comerciales configurados; no sustituye asesoría
fiscal ni emite CFDI. Ninguna tasa se crea automáticamente para un tenant.

## Configuración

`tax_rates`: `id`, `tenant_id`, `name`, `tax_code`, `direction` (`transfer|withholding`),
`factor_type`, `rate_or_quota`, `is_active`, `effective_from`, `effective_to`, `catalog_version`,
timestamps.

`product_tax_profiles`: `id`, `tenant_id`, `product_id`, `product_variant_id nullable`,
`tax_object_code`, `product_service_code nullable`, `unit_code nullable`, vigencia.

`product_tax_profile_rates`: `id`, `tenant_id`, `profile_id`, `tax_rate_id`, `calculation_order`,
`price_included`, `compounds_on_prior`. La relación permite cero, uno o varios componentes fiscales;
orden y composición deben validarse con contador/PAC antes de activarse y quedan congelados en snapshot.

La categoría puede sugerir un perfil al crear producto, pero la venta resuelve un perfil explícito de
producto/variante; no depende de fallback mutable durante cálculo histórico.

## API propuesta

- `GET/POST /api/v1/tax/rates`
- `PATCH /api/v1/tax/rates/{id}`; desactivar, nunca borrar si fue usada.
- `GET/PUT /api/v1/catalog/products/{id}/tax-profile`
- `POST /api/v1/pricing/quote` para preview no persistente; el create de orden recalcula.

Permisos: `tax.view`, `tax.manage`, `tax.assign`; sólo owner administra por defecto, manager puede ver.
Writes exigen idempotencia y auditoría `tax.rate.*`/`catalog.tax_profile.updated`.

## Cálculo

- Descuentos reducen la base antes del impuesto.
- Inclusivo: base derivada del neto con fórmula versionada; exclusivo: impuesto se suma a la base.
- `exempt` guarda base y factor, sin tasa/importe.
- Múltiples componentes respetan orden/composición configurados y se guardan por separado; el servidor
  rechaza una combinación no soportada en vez de aproximarla.
- Mezcla de líneas se calcula por línea y se agrega por dirección/código/factor/tasa.
- El servidor rechaza tasa inactiva/no vigente y perfiles incompletos.

## Seguridad y datos

- RLS forzado, tenant refs compuestas y tests de IDs adivinados.
- Catálogos fiscales se versionan; actualizar catálogo no reescribe configuración histórica.
- No guardar certificados/CSD en este dominio.

## Aceptación

- Golden: exclusivo, inclusivo, exento, tasa cero, transferencia+retención, componentes ordenados,
  mezcla, descuento+impuesto y residuos.
- Cashier no administra tasas; tenant B recibe `404`.
- Quote y orden producen mismo resultado para misma versión/configuración.
- Cambiar/desactivar tasa no cambia órdenes previas.
- Recibo/reportes reconcilian gross - descuentos + impuestos = total.
