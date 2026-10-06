import json
import re
from uuid import UUID

from fastapi import HTTPException
from sqlalchemy import text

from app.assistant import budget, provider, storage
from app.assistant import repository as repo

GUIDES = {
    "6141fe70-9b98-4d18-865e-a874a72e1771": (
        "Configurar mi negocio",
        (
            "En Configuración puedes guardar el nombre comercial, correo y tel"
            "éfono de soporte, y zona horaria. Revisa el nombre y pie del tick"
            "et, logo y papel de 58 u 80 mm. El asistente propone cambios; tú "
            "revisas y confirmas."
        ),
        "/settings/business-profile",
    ),
    "6141fe70-9b98-4d18-865e-a874a72e1772": (
        "Cargar un catálogo",
        (
            "El catálogo acepta CSV o XLSX con la plantilla de Kova. Revisa no"
            "mbre, SKU, precio, costo, categoría, control de inventario, stock"
            " inicial y umbral. El archivo admite hasta mil productos y dos Mi"
            "B. Corrige errores y confirma antes de importar."
        ),
        "/catalog",
    ),
    "6141fe70-9b98-4d18-865e-a874a72e1773": (
        "Entender mis resultados",
        (
            "Análisis usa ventas completadas y reembolsos del periodo seleccio"
            "nado. Los importes históricos proceden de la venta registrada. La"
            " reposición usa inventario disponible, reservas y consumo previo;"
            " no se calcula cuando faltan datos. La venta offline se incluye d"
            "espués de sincronizar."
        ),
        "/reports",
    ),
    "6141fe70-9b98-4d18-865e-a874a72e1774": (
        "Trabajar por sucursal",
        (
            "Selecciona una sucursal antes de operar. Ventas, caja e inventari"
            "o se consultan por sucursal. Catálogo, precios, permisos y suscri"
            "pción pertenecen al negocio. La comparación de sucursales requier"
            "e autorización para reportes."
        ),
        "/settings/branches",
    ),
}
SECRET = re.compile(
    "(?i)(?:sk_(?:live|test)_[a-z0-9]+|eyJ[a-zA-Z0-9_-]+\\.[a-zA-Z0-9_-"
    "]+\\.[a-zA-Z0-9_-]+|(?:password|contraseña|api[_ -]?key|secret[_ -"
    "]?key)\\s*[:=]\\s*\\S+)"
)
DOCUMENT_CODE = re.compile(
    r"(?im)(?:^\s*```(?:python|javascript|typescript|js|ts|sql|bash|sh|"
    r"java|go|rust|php|ruby|c\+\+|dockerfile)\b|"
    r"^\s*(?:from\s+[.\w]+\s+import\s|import\s+[\w@]|"
    r"(?:async\s+)?def\s+\w+\s*\(|(?:export\s+)?(?:const|let|function)\s+\w+)|"
    r"^\s*(?:select\s+.+\s+from\s|insert\s+into\s|delete\s+from\s|"
    r"drop\s+table\s|alter\s+table\s)|<script\b|^#!\s*/.*(?:sh|python))"
)


def safe_text(value: str) -> str:
    if SECRET.search(value):
        raise HTTPException(
            422, "El contenido parece incluir credenciales. Retíralas antes de enviarlo."
        )
    value = re.sub(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b", "[correo omitido]", value)
    return value


def safe_document_text(value: str) -> str:
    # Conservative supplemental filter for code disguised as business documents.
    # It is not a universal classifier or a replacement for the tool/ACL boundary.
    if DOCUMENT_CODE.search(value):
        raise HTTPException(
            422, "El documento parece contener código. Carga solo información del negocio."
        )
    return safe_text(value)


def search(db, tenant, user, query: str) -> list[dict]:
    if not 1 <= len(query) <= 400:
        raise HTTPException(422, "Consulta de conocimiento inválida.")
    matches = []
    words = set(re.findall(r"\w{4,}", query.lower()))
    for key, (title, content, path) in GUIDES.items():
        if words & set(re.findall(r"\w{4,}", (title + " " + content).lower())):
            matches.append(
                {
                    "id": key,
                    "title": title,
                    "page": 1,
                    "content": content,
                    "path": path,
                    "public": True,
                }
            )
    # No document text is sent externally unless the requesting user consented.
    pref = repo.records(db, tenant, user, "preferences").first()
    from app.config import settings

    if (
        not settings.assistant_documents_enabled
        or not storage.ready()
        or not pref
        or not pref.data.get("document_consent")
    ):
        return matches[:8]
    if (
        not repo.records(db, tenant, user, "document", shared=True)
        .filter_by(status="ready")
        .first()
    ):
        return matches[:8]
    budget.reserve(
        db,
        tenant,
        user,
        model=provider.EMBEDDING_MODEL,
        input_tokens=len(query.encode()),
        output_tokens=0,
    )
    db.commit()
    vector = provider.embed([safe_text(query)])[0]
    rows = db.execute(
        text("""WITH eligible AS MATERIALIZED (
        SELECT c.id,c.document_id,c.page,c.content,c.embedding,r.data->>'filename' AS title
        FROM assistant_chunks c JOIN assistant_records r ON r.id=c.document_id AND
r.tenant_id=c.tenant_id
        WHERE c.tenant_id=:tenant AND r.kind='document' AND r.status='ready'
        AND (r.owner_user_id=:uid OR r.shared) AND c.embedding IS NOT NULL
    ), semantic AS (
        SELECT id,row_number() OVER (ORDER BY embedding OPERATOR(extensions.<=>) CAST(:vec AS
extensions.vector)) AS rank
        FROM eligible WHERE embedding OPERATOR(extensions.<=>) CAST(:vec AS extensions.vector)
< 0.65 LIMIT 20
    ), lexical AS (
        SELECT id,row_number() OVER (ORDER BY
ts_rank_cd(to_tsvector('spanish',content),websearch_to_tsquery('spanish',:q)) DESC) AS rank
        FROM eligible WHERE to_tsvector('spanish',content) @@
websearch_to_tsquery('spanish',:q) LIMIT 20
    ), scored AS (
        SELECT id,SUM(score) AS score FROM (
            SELECT id,1.0/(60+rank) AS score FROM semantic UNION ALL
            SELECT id,1.0/(60+rank) AS score FROM lexical
        ) s GROUP BY id
    ) SELECT e.document_id,e.page,e.content,e.title FROM eligible e JOIN scored s USING(id)
      ORDER BY s.score DESC,e.id LIMIT 8"""),
        {"tenant": tenant, "uid": user, "vec": json.dumps(vector), "q": query},
    ).all()
    for row in rows:
        if not storage.exists(tenant, row.document_id):
            continue
        matches.append(
            {
                "id": str(row.document_id),
                "title": row.title,
                "page": row.page,
                "content": safe_text(row.content[:1200]),
                "path": f"/api/v1/assistant/documents/{row.document_id}/source",
                "public": False,
            }
        )
    return matches[:8]


def valid_sources(db, tenant, user, ids):
    if any(str(identifier) not in GUIDES for identifier in ids):
        pref = repo.records(db, tenant, user, "preferences").populate_existing().first()
        if not pref or not pref.data.get("document_consent"):
            return False
    for identifier in ids:
        if str(identifier) in GUIDES:
            continue
        try:
            doc = repo.get(db, tenant, user, "document", UUID(str(identifier)), shared=True)
        except HTTPException:
            return False
        if doc.status != "ready" or not storage.ready() or not storage.exists(tenant, doc.id):
            return False
    return True
