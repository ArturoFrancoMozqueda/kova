# Alta pública de tarjeta por dispositivo

Estado: autorizado el 2026-10-26; implementación y validación locales completas.
Sin Wallet, proveedores nuevos, OTP ni recuperación por contacto. Publicación y equipos físicos
pendientes; evidencia y conteos en `docs/current-sprint.md`.

## Alcance

El dueño habilita explícitamente altas públicas por sucursal. Además se exige política de puntos
activa autorizada por un dueño vigente, negocio/billing activos y menú publicado. El estado inicial
es cerrado; visitar el menú nunca crea clientes ni puntos. El nombre o apodo es informativo y no
verificado. Cada alta crea un Customer nuevo sin teléfono/correo; jamás busca, une o recupera una
ficha anterior por nombre, contacto o código. Los puntos siguen requiriendo ventas reales.

El código de socio `KV-XXXX-XXXX-XXXX-XXXX` contiene 80 bits aleatorios Crockford base32. Sólo
identifica la ficha al equipo autenticado en Caja; no autentica ni permite recuperar saldo público.
El QR local codifica exclusivamente ese código, nunca cookies, credenciales o enlaces de tarjeta.

## Contrato

- `GET/PUT /api/v1/loyalty/enrollment-policy`: dueño, CSRF/idempotencia para PUT.
  GET `{enabled,version}`; PUT `{enabled,expected_version}` agrega una revisión inmutable.
- Catálogo público añade `loyalty_available`, derivado del opt-in y capacidades actuales.
  Es disponibilidad de nuevas altas, no una afirmación de saldo ni de beneficios.
- `GET /api/v1/public/loyalty/membership?menu=PUBLIC_MENU_TOKEN`, credentials include,
  no-referrer, devuelve `{available,enrolled,business_name,branch_name,policy,reward,csrf_token,
  card,card_path}`. `card` es la proyección actual de tarjeta más `member_code` y QR local opcional.
  `card_path` es `/lealtad?menu=...`, sin credenciales. Si no está disponible y no hay miembro,
  no establece cookies ni crea registros. Miembros vigentes pueden leer con altas/puntos pausados.
- `POST /api/v1/public/loyalty/membership/enroll` recibe `{menu_token,name,confirmed:true}`,
  nombre/apodo de 1–80 caracteres. Exige origen confiable estricto, Idempotency-Key y header
  `X-Kova-Member-CSRF` obtenido por bootstrap. Respuesta 201 `{card,card_path}`.
  Si también viajan cookies del comercio, conserva el middleware CSRF comercial y exige su header.
- `POST /api/v1/loyalty/members/resolve {code}` requiere `orders.create`, `customers.view`,
  billing, tenant y sucursal autenticados. Respuesta mínima `{customer:{id,name,is_active}}`.
  Código inexistente/inactivo/expirado/ajeno produce el mismo 404. Sólo normaliza mayúsculas,
  espacios y guiones; no es búsqueda parcial ni por contacto.

## Pre-sesión, fijación y reintentos

Cada programa usa una cookie de nombre derivado por HMAC del tenant/sucursal, host-only,
HttpOnly, SameSite Strict, Secure en producción y Path `/api/v1/public/loyalty`. Su valor tiene
audiencia propia, scope firmado, nonce de 256 bits y expiración obligatoria. No se acepta como
sesión comercial, no se devuelve a JavaScript ni se persiste en localStorage/sessionStorage.

Bootstrap genera sólo una pre-cookie de 15 minutos. No autentica un miembro y nunca permite leer
su saldo. El grant CSRF firmado se vincula a esa pre-cookie y programa; vive sólo en memoria.
Al aceptar el alta, el servidor rota a una credencial de miembro nueva, impredecible y con
expiración fija de 180 días. La pre-cookie consumida no es una credencial de esa tarjeta.

Bloqueo por sucursal y unicidad de bootstrap impiden dos perfiles por carreras. La operación
idempotente se liga al bootstrap, nombre normalizado y clave; la clave pública se transforma a
un namespace privado para no ocupar claves financieras. Repetir la misma operación permite
reconstruir la misma cookie de miembro, sin guardar secretos en texto ni crear otro cliente.
Si el navegador ya recibió la cookie pero perdió el cuerpo, se admite replay de la misma operación
con su grant original, vinculado al bootstrap consumido de ese miembro. Otra clave/cuerpo no
reclama esa tarjeta. Una pre-sesión consumida sin su clave requiere revisión; no se recupera por
nombre/código ni se crea otro perfil silenciosamente. Dos bootstrap simultáneos pueden invalidar
el grant de la pestaña anterior si aún no comparten cookie: falla sin efectos y exige refrescar el contexto.
El navegador conserva únicamente UUID de operación por programa en sessionStorage, nunca alias,
grant ni cookie. GET con ese Idempotency-Key sólo recupera la operación exacta si la pre-cookie
firmada original sigue vigente; la cookie de miembro de otra operación devuelve409. Sin cookie
original no se recupera identidad ni se duplica el alta: operation_hash es único permanentemente.

## Lectura, revocación y datos

Cookie de miembro válida consulta sólo su tenant/sucursal/cliente bajo runtime/RLS. Se verifican
negocio/billing, cliente activo, snapshot de actualización del cliente y autorizante original del
opt-in todavía dueño activo con acceso. Editar/desactivar/reactivar el cliente no revive tarjetas
anteriores. Pausar nuevas altas no borra puntos ni bloquea una tarjeta vigente. Retirar el menú
retira su enlace público; miembros válidos conservan la lectura de su propia tarjeta.

Nueva política y miembro son tenant-scoped, FORCE RLS y append-only para runtime. El miembro
conserva cliente, revisión de consentimiento, código, fecha/expiración e identificadores de
operación; hashes de cookies, bootstrap y operación se excluyen del export y de logs. Purga elimina
miembros antes de clientes/políticas. El downgrade rechaza perder altas o consentimiento.
Respuestas son no-store/no-referrer/noindex, alta y lookup tienen límites por IP.

No hay marketing implícito, premios inventados, acumulación por visita, acceso por QR al saldo,
autoenlace de clientes previos, recuperación entre dispositivos, envío de mensajes o pagos externos.
Borrar cookies o cambiar de navegador pierde este acceso; el negocio conserva los registros.
