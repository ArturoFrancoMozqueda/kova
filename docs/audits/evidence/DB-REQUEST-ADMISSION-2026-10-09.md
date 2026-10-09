# Concurrencia del stack real y admisión de sesiones — 2026-10-09

## Reproducción y causa

La verificación integrada original, con seis casos navegador concurrentes, produjo
pantallas vacías y HTTP500. El resumen del log mostró siete `TimeoutError` de
SQLAlchemy en branches, telemetry, settings y assistant; las esperas comenzaban en
`get_current_session` al pedir conexión. No se observaron locks persistentes de
PostgreSQL ni transacciones abandonadas después de terminar.

Se reprodujo la causa en PostgreSQL local desechable `kova_access_v2`:
una dependencia síncrona adquiere conexión, devuelve la sesión y el endpoint
síncrono necesita otro turno del mismo pool de workers. Nuevas dependencias
que esperan conexiones pueden ocupar todos los workers; las peticiones que ya
poseen conexiones no consiguen ejecutar el endpoint y devolverlas. FastAPI
separa los workers de salida del context manager, pero las solicitudes todavía
no habían alcanzado esa salida.

Regresión previa al arreglo: pool de una conexión, sin overflow, dos workers,
ocho GET concurrentes: **seis HTTP500 y dos HTTP200**. Usa SQLAlchemy y PostgreSQL
reales, no un semaphore artificial. Runtime `kova_app` sin superuser/bypass RLS;
la aplicación verificó las 60 tablas protegidas al importar el stack.

## Cambio mínimo

- `get_db` y `get_privileged_db` conservan generators y sesiones síncronas.
  Cada uno tiene una subdependencia `async yield` de admisión.
- La espera de capacidad ocurre antes de entrar al pool síncrono; los endpoints
  y consultas ORM siguen ejecutándose fuera del event loop.
- Gate runtime refleja size+overflow configurados (**5/0 por defecto**).
  Gate privilegiado separado refleja su pool **2+2**. No se aumentaron conexiones,
  workers, timeouts ni tolerancia de las pruebas originales.
- El orden de dependencias libera/cierra cada sesión antes de devolver admisión.
  Se crea una sesión nueva por solicitud; no se comparte transacción ni contexto RLS.
- Los limiters se guardan por event loop con claves débiles: no mezclan esperas de
  loops distintos ni retienen loops TestClient cerrados. Cada worker ASGI ejecuta
  su propio event loop; no se cambia la configuración de workers.
- Las dos rutas que usan ambos motores (`verify/resend` y `logout-all`) adquieren
  en el mismo orden privilegiado→runtime; no se encontró orden inverso.

## Evidencia después del arreglo

Tres regresiones PostgreSQL aprobadas:

1. Runtime pool1/workers2: ocho respuestas200; se repite en otro loop y dos
   TestClients independientes. Un error controlado de endpoint libera la conexión
   y la petición siguiente responde200.
2. Privileged pool4/workers5: mismas comprobaciones de concurrencia, nuevos loops,
   TestClient, error controlado y pool sin conexiones prestadas al terminar.
3. Un waiter cancelado no consume capacidad ni adquiere conexión. El request en
   curso conserva su slot, el siguiente completa y el pool/limiter terminan libres.

Comando focal (URLs locales exclusivas; no credenciales productivas):

```sh
pytest app/tests/test_db_dependency_admission.py app/tests/test_settings_role_contract.py app/tests/test_auth_refresh_concurrency.py -q
ruff check app/db.py app/tests/test_db_dependency_admission.py
```

No se modificaron tests existentes, migrations, datos esperados, auth, cookies,
RLS ni APIs públicas. El coordinador repetirá backend completo y los seis casos
originales con su misma concurrencia antes de publicar. No se tocó ni detuvo su
servidor/DB/browser; esta reproducción usa únicamente la base local del equipo.

Referencias primarias revisadas: [FastAPI async y dependencies](https://fastapi.tiangolo.com/async/),
código instalado `fastapi/concurrency.py` y
[discusión del proyecto sobre pools/deadlocks](https://github.com/fastapi/fastapi/discussions/6628).
