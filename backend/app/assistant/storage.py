"""Private R2 objects. Keys and destinations are never supplied by the model."""

import re
from uuid import UUID

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError
from fastapi import HTTPException

from app.config import settings


def ready() -> bool:
    return bool(
        settings.assistant_r2_access_key
        and settings.assistant_r2_secret_key
        and re.fullmatch(r"[a-fA-F0-9]{32}", settings.assistant_cloudflare_account_id)
        and re.fullmatch(r"[a-z0-9][a-z0-9-]{2,62}", settings.assistant_r2_bucket)
    )


def client():
    if not ready():
        raise HTTPException(503, "El almacenamiento privado aún no está configurado.")
    return boto3.client(
        "s3",
        endpoint_url=f"https://{settings.assistant_cloudflare_account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=settings.assistant_r2_access_key.get_secret_value(),
        aws_secret_access_key=settings.assistant_r2_secret_key.get_secret_value(),
        region_name="auto",
        config=Config(
            connect_timeout=5, read_timeout=30, retries={"total_max_attempts": 1}, proxies={}
        ),
    )


def key(tenant: UUID, document: UUID) -> str:
    return f"{tenant}/{document}"


def put(tenant: UUID, document: UUID, content: bytes) -> None:
    try:
        client().put_object(
            Bucket=settings.assistant_r2_bucket,
            Key=key(tenant, document),
            Body=content,
            ContentType="application/octet-stream",
        )
    except (BotoCoreError, ClientError):
        raise HTTPException(503, "No se pudo guardar el archivo privado.") from None


def get(tenant: UUID, document: UUID) -> bytes:
    try:
        response = client().get_object(
            Bucket=settings.assistant_r2_bucket, Key=key(tenant, document)
        )
        with response["Body"] as stream:
            content = stream.read(20 * 1024 * 1024 + 1)
        if len(content) > 20 * 1024 * 1024:
            raise HTTPException(422, "Archivo demasiado grande.")
        return content
    except (BotoCoreError, ClientError):
        raise HTTPException(503, "Archivo no disponible.") from None


def delete(tenant: UUID, document: UUID) -> None:
    try:
        client().delete_object(Bucket=settings.assistant_r2_bucket, Key=key(tenant, document))
    except (BotoCoreError, ClientError):
        raise HTTPException(
            503, "No se pudo retirar el archivo. Se conservará el estado de borrado."
        ) from None


def exists(tenant: UUID, document: UUID) -> bool:
    try:
        client().head_object(Bucket=settings.assistant_r2_bucket, Key=key(tenant, document))
        return True
    except ClientError as exc:
        if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
            return False
        raise HTTPException(503, "No se pudo comprobar la fuente privada.") from None
    except BotoCoreError:
        raise HTTPException(503, "No se pudo comprobar la fuente privada.") from None


def purge_tenant(db, tenant: UUID):
    from sqlalchemy import text

    ids = list(
        db.execute(
            text("SELECT id FROM assistant_records WHERE tenant_id=:tenant AND kind='document'"),
            {"tenant": tenant},
        ).scalars()
    )
    used = db.execute(
        text("SELECT 1 FROM assistant_records WHERE tenant_id=:tenant LIMIT 1"), {"tenant": tenant}
    ).scalar()
    if not used:
        return
    if ready():
        try:
            client().put_object(
                Bucket=settings.assistant_r2_bucket,
                Key=f"deleted-tenants/{tenant}",
                Body=b"deleted",
            )
        except (BotoCoreError, ClientError):
            raise HTTPException(503, "No se pudo registrar la retirada del negocio.") from None
    for identifier in ids:
        delete(tenant, identifier)


def tenant_deleted(tenant: UUID) -> bool:
    if not ready():
        return False
    try:
        client().head_object(Bucket=settings.assistant_r2_bucket, Key=f"deleted-tenants/{tenant}")
        return True
    except ClientError as exc:
        if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 404:
            return False
        raise HTTPException(503, "No se pudo verificar el estado del negocio.") from None
    except BotoCoreError:
        raise HTTPException(503, "No se pudo verificar el estado del negocio.") from None
