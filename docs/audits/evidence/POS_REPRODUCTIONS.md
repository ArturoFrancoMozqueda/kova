# Reproducciones locales de integridad POS

Auditoría del commit `837cf3f21c8b511aedf91b70ba61484fc08dee1f`, 2026-09-06.
Solo datos sintéticos en PostgreSQL 17 local desechable, puerto 55469.
El código siguiente se ejecutó desde la copia exportada con `git archive`, sin `.env`.
No modifica implementación ni tests. Las alteraciones de intercalado en memoria se indican explícitamente.

```python
import ast, os, sys, logging
from pathlib import Path
root=Path('C:/Users/fkr2d/AppData/Local/Temp/kova-audit-5354139946cb4179ae437559bb4070c0/repo/backend')
assert not (root/'.env').exists()
for cls in ast.parse((root/'app/config.py').read_text()).body:
    if isinstance(cls,ast.ClassDef) and cls.name=='Settings':
        for field in cls.body:
            if isinstance(field,ast.AnnAssign) and isinstance(field.target,ast.Name):
                os.environ.pop(field.target.id.upper(),None)
url='postgresql+psycopg://pos@127.0.0.1:55469/kova_pos_audit'
os.environ.update(APP_ENV='local',DATABASE_URL=url,APP_DATABASE_URL=url,MIGRATION_DATABASE_URL=url,SECRET_KEY='isolated-audit-only-nonproduction-key')
os.chdir(root)
sys.path.insert(0,str(root))
from alembic.config import Config
from alembic import command
command.upgrade(Config('alembic.ini'),'head')
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session
from datetime import UTC, datetime
from decimal import Decimal
from uuid import uuid4, UUID
from app.orders import service as orders
from app.orders.schemas import OrderCreate, RefundCreate
from app.sync.service import sync_offline_sales
from app.sync.schemas import OfflineSaleSyncItem
from app.shifts import service as shifts
from app.shifts.schemas import ShiftOpenCreate, ShiftCloseCreate, CashMovementCreate
engine=create_engine(url)
tenant,user,p1,p2=uuid4(),uuid4(),uuid4(),uuid4()
with engine.begin() as conn:
    conn.execute(text("INSERT INTO tenants(id,name,slug) VALUES (:t,'Audit POS',:slug)"),{'t':tenant,'slug':str(tenant)})
    conn.execute(text("INSERT INTO users(id,email,hashed_password,is_email_verified) VALUES (:u,:email,'not-a-login-hash',true)"),{'u':user,'email':str(user)+'@example.invalid'})
    conn.execute(text("INSERT INTO memberships(id,tenant_id,user_id,role) VALUES (:id,:t,:u,'owner')"),{'id':uuid4(),'t':tenant,'u':user})
    conn.execute(text("INSERT INTO products(id,tenant_id,name,price_amount,track_inventory) VALUES (:p1,:t,'A',5,false),(:p2,:t,'B',15,false)"),{'p1':p1,'p2':p2,'t':tenant})
    conn.execute(text("DO $$ BEGIN IF NOT EXISTS(SELECT FROM pg_roles WHERE rolname='kova_app') THEN CREATE ROLE kova_app LOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$"))
    conn.execute(text('GRANT USAGE ON SCHEMA public TO kova_app'))
    conn.execute(text('GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO kova_app'))
    conn.execute(text('GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO kova_app'))
body=OrderCreate(items=[{'product_id':p1,'quantity':1},{'product_id':p2,'quantity':1}],payments=[{'method':'bank_transfer','amount':'20.00'}])
with Session(engine) as db:
    _,sale=orders.create_order(db,tenant_id=tenant,user_id=user,body=body,idempotency_key='refund-original')
    item=next(i for i in sale['items'] if i['product_id']==str(p1))
    refund=RefundCreate(items=[{'order_item_id':item['id'],'quantity':1}]*2,reason='customer_return',refund_payment_method='bank_transfer')
    status,result=orders.create_refund(db,tenant_id=tenant,user_id=user,order_id=UUID(sale['id']),body=refund,idempotency_key='duplicate-lines')
    qty=db.execute(text('SELECT sum(quantity) FROM refund_items WHERE order_item_id=:i'),{'i':UUID(item['id'])}).scalar()
    print('DUPLICATE_REFUND_LINES',status,'sold=1','refunded='+str(qty),'amount='+result['refunded_amount'])
    stock=db.execute(text('SELECT sum(quantity_delta) FROM inventory_movements WHERE product_id=:p'),{'p':p1}).scalar()
    print('UNTRACKED_REFUND_MOVEMENTS',stock)
with Session(engine) as db:
    orders.create_order(db,tenant_id=tenant,user_id=user,body=body,idempotency_key='expired-key')
    db.execute(text("UPDATE idempotency_keys SET expires_at=now()-interval '1 day' WHERE tenant_id=:t AND key='expired-key'"),{'t':tenant})
    db.commit()
    status,result=orders.create_order(db,tenant_id=tenant,user_id=user,body=body,idempotency_key='expired-key')
    exists=db.execute(text('SELECT count(*) FROM orders WHERE id=:i'),{'i':UUID(result['id'])}).scalar()
    print('EXPIRED_IDEMPOTENCY',status,'returned_order_exists='+str(exists))
runtime=create_engine('postgresql+psycopg://kova_app@127.0.0.1:55469/kova_pos_audit')
with Session(runtime) as db:
    db.execute(text("SELECT set_config('app.tenant_id',:t,true)"),{'t':str(tenant)})
    results=sync_offline_sales(db,tenant_id=tenant,user_id=user,sales=[OfflineSaleSyncItem(client_uuid=uuid4(),order=body),OfflineSaleSyncItem(client_uuid=uuid4(),order=body)])
    print('RLS_BATCH',[(r.status,r.error) for r in results])
with Session(engine) as db:
    _,shift=shifts.open_shift(db,tenant_id=tenant,user_id=user,body=ShiftOpenCreate(opening_cash_amount='100.00'),idempotency_key='open-proof')
    sid=UUID(shift['id'])
    move=CashMovementCreate(type='cash_out',amount='10.00',reason='same physical withdrawal')
    shifts.record_cash_movement(db,tenant_id=tenant,user_id=user,shift_id=sid,body=move)
    shifts.record_cash_movement(db,tenant_id=tenant,user_id=user,shift_id=sid,body=move)
    count=db.execute(text("SELECT count(*) FROM cash_movements WHERE shift_id=:s AND type='cash_out'"),{'s':sid}).scalar()
    print('DUPLICATE_CASH_MOVEMENT','physical=1','records='+str(count))
engine.dispose(); runtime.dispose()
```

## Resultado

Ejecución completada: código de salida 0. Migraciones desde base vacía hasta `0062_accountant_packages` aplicadas solamente en la base desechable.

```text
DUPLICATE_REFUND_LINES 201 sold=1 refunded=2 amount=10.00
UNTRACKED_REFUND_MOVEMENTS 2
EXPIRED_IDEMPOTENCY 201 returned_order_exists=0
RLS_BATCH [('synced', None), ('failed', 'Sync error: DataError')]
DUPLICATE_CASH_MOVEMENT physical=1 records=2
```

El segundo elemento RLS falla con `psycopg.errors.InvalidTextRepresentation: invalid input syntax for type uuid: ""` al consultar `idempotency_keys`: el commit de la primera venta eliminó el contexto transaccional. No se simuló la consulta ni el commit; se usó `kova_app` con `NOSUPERUSER NOBYPASSRLS` y las policies de las migraciones.

El caso de idempotencia vence artificialmente la clave en la base sintética para reproducir inmediatamente un retry posterior al TTL. **La respuesta lógica 201 con UUID inexistente se reprodujo con el rol propietario que omite RLS**, debido al rollback dentro de `idempotency.store`. Con el rol runtime `kova_app`, una reproducción posterior produjo `DataError` al perder el contexto tenant después de ese rollback: no se demostró una respuesta 201 ficticia en producción. Ambos caminos muestran por qué deben corregirse conjuntamente KOV-001 y KOV-004; véase también [la reproducción con rol runtime](BILLING_PRIVACY_REPRODUCTIONS.md).

La devolución duplicada conserva el límite monetario global: una venta de $20 con una línea de $5 vendida una sola vez admite esa misma línea dos veces en una devolución de $10. Por eso el control por método no evita el exceso de unidades. Además genera movimientos positivos aunque la venta original no manejó inventario.

## Intercalado real de cierre y movimiento

Prueba adicional ejecutada sobre la misma base sintética: dos `Session` y dos hilos; se envolvió temporalmente en memoria `calculator.calculate_expected_cash` para pausar **después** de calcular $80 y **antes** de devolver el valor a `close_shift`. Mientras el cierre esperaba, la segunda sesión llamó al servicio real `record_cash_movement(cash_in=10)` y confirmó. Se liberó el cierre, que persistió su snapshot original. No se cambiaron queries, respuestas ni archivos de implementación.

```text
SHIFT_RACE frozen=80.00 ledger=90.00
```

El intercalado demuestra que una operación aceptada mientras el turno todavía aparece abierto queda fuera del importe congelado. El cierre debe serializarse con todas las escrituras al turno mediante un bloqueo común y una política explícita para ventas offline tardías; bloquear únicamente el cierre no basta.
