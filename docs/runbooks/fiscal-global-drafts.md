# Cierres de ventas para contador

`fiscal_global_drafts` está disponible por defecto para todos los tenants. Un override booleano
`false` permite excluir de forma dirigida a un tenant; valores ausentes o malformados conservan el
default global.

## Kill switch

`FISCAL_GLOBAL_DRAFTS_KILL_SWITCH=false` es el valor normal. Configurarlo en `true` en el backend
domina defaults y overrides, reporta el flag como `false` en la sesión, bloquea las rutas fiscales y
detiene el scheduler antes de procesar tenants. Después de cambiarlo, reiniciar las instancias del
backend y comprobar `/api/v1/auth/session` con una cuenta operativa. No registrar valores de entorno
ni identificadores de tenants durante la comprobación.

La ruta y las tablas conservan `global-drafts` por compatibilidad, pero el producto se presenta como
**Cierres para contador**. Kova congela evidencia operativa: no calcula IVA/IEPS, no emite CFDI y no
se conecta con un PAC.

## Descargas

- Cierres `accountant-package-v2`: `accountant-package.zip` contiene `resumen.pdf`,
  `operaciones.csv`, `partidas.csv`, `ajustes.csv` y `manifest.json` con SHA-256.
- Cierres anteriores: `accountant-report.csv` permanece disponible como formato legado.
- Ambas respuestas usan `Cache-Control: no-store`; los CSV son UTF-8 con BOM y neutralizan celdas
  que una hoja de cálculo podría interpretar como fórmulas.
- El ZIP se genera bajo demanda, usa nombres fijos y orden determinista, y falla cerrado si sus filas
  no reconcilian con el cierre congelado.

## Estado de factura individual

El propietario puede confirmar una venta facturada fuera de Kova con referencia y fecha de emisión,
o reabrirla. Cada cambio agrega un evento inmutable y auditado; no se sobrescribe el anterior. El
gerente puede consultar el estado, pero no modificarlo. Una venta confirmada se excluye del cierre.

## Devoluciones y ajustes

Sólo se restan del periodo original las devoluciones creadas antes de su límite local. Las
devoluciones posteriores y las reaperturas de ventas excluidas se incorporan al siguiente cierre
como ajustes vinculados al cierre original. Por ello es válido un cierre sin ventas y con ajustes.

## Verificación de lanzamiento

Antes de habilitarlo ampliamente:

1. Aplicar la migración y ejecutar las pruebas fiscal, RLS, RBAC, CSRF e idempotencia.
2. Descargar un cierre normal, uno con exclusiones y uno sólo con ajustes; verificar PDF, CSV y
   checksums del manifest.
3. Validar los tres paquetes anonimizados con un contador mexicano y registrar por escrito su
   aceptación. Esta validación humana es obligatoria y no puede sustituirse con pruebas automáticas.
4. Conservar disponible el kill switch para rollback inmediato.
