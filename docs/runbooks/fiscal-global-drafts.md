# Borradores fiscales internos

`fiscal_global_drafts` está disponible por defecto para todos los tenants. Un override booleano
`false` permite excluir de forma dirigida a un tenant; valores ausentes o malformados conservan el
default global.

## Kill switch

`FISCAL_GLOBAL_DRAFTS_KILL_SWITCH=false` es el valor normal. Configurarlo en `true` en el backend
domina defaults y overrides, reporta el flag como `false` en la sesión, bloquea las rutas fiscales y
detiene el scheduler antes de procesar tenants. Después de cambiarlo, reiniciar las instancias del
backend y comprobar `/api/v1/auth/session` con una cuenta operativa. No registrar valores de entorno
ni identificadores de tenants durante la comprobación.

La exportación CSV se genera bajo demanda desde el batch y sus snapshots; no persiste archivos y no
emite CFDI, XML, PDF ni timbrado PAC.
