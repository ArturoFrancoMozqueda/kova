"""An exhaustive list of read tools. No SQL, network or mutation executor tool."""

from datetime import date

from fastapi import HTTPException
from pydantic import Field

from app.assistant import knowledge
from app.assistant import repository as repo
from app.assistant.models import now
from app.branches.reports import compare_branches
from app.branches.scope import active_branch_id
from app.business_settings.models import BusinessProfile, ReceiptSettings
from app.catalog.models import Category, Product
from app.orders.models import Order
from app.reports import service as reports
from app.shared.timezone import tenant_timezone
from app.shared.validation import StrictModel


class Empty(StrictModel):
    pass


class Range(StrictModel):
    start_date: date | None = None
    end_date: date | None = None


class Query(StrictModel):
    query: str = Field(min_length=1, max_length=400)


class CatalogQuery(StrictModel):
    query: str = Field(default="", max_length=100)


SCHEMAS = {
    "get_configuration": Empty,
    "get_sales": Range,
    "get_inventory": Range,
    "get_catalog": CatalogQuery,
    "get_top_products": Range,
    "compare_branches": Range,
    "search_knowledge": Query,
    "get_memory": Empty,
}
DESCRIPTIONS = {
    "get_configuration": "Lee configuración y pendientes reales de onboarding.",
    "get_sales": "Lee métricas exactas del periodo y sucursal activos; máximo 92 días.",
    "get_inventory": "Lee señales de inventario y reposición calculadas por Kova.",
    "get_catalog": "Busca por nombre hasta diez productos y categorías del negocio.",
    "get_top_products": "Lee cinco productos más vendidos con métricas exactas de Kova.",
    "compare_branches": "Compara hasta cinco sucursales por venta neta; incluye total del negocio.",
    "search_knowledge": "Busca guías públicas y documentos privados autorizados con fuentes.",
    "get_memory": "Lee preferencias y objetivos que el usuario guardó explícitamente.",
}
TOOLS = [
    {
        "type": "function",
        "function": {
            "name": name,
            "description": DESCRIPTIONS[name],
            "parameters": schema.model_json_schema(),
        },
    }
    for name, schema in SCHEMAS.items()
]


def configuration(db, tenant):
    profile = db.query(BusinessProfile).filter_by(tenant_id=tenant).first()
    receipt = db.query(ReceiptSettings).filter_by(tenant_id=tenant).first()
    sale = db.query(Order.id).filter(Order.tenant_id == tenant, Order.status == "completed").first()
    product = (
        db.query(Product.id)
        .filter(Product.tenant_id == tenant, Product.is_active.is_(True))
        .first()
    )
    return {
        "today": now().astimezone(tenant_timezone(db, tenant_id=tenant)).date().isoformat(),
        "public_name": profile.public_name if profile else None,
        "timezone": profile.timezone if profile else "America/Mexico_City",
        "receipt_business_name": receipt.receipt_business_name if receipt else None,
        "footer": receipt.footer if receipt else None,
        "paper_width_mm": receipt.paper_width_mm if receipt else None,
        "pending": [
            key
            for key, done in [
                ("business_profile", bool(profile)),
                ("receipt", bool(receipt)),
                ("first_product", bool(product)),
                ("first_sale", bool(sale)),
            ]
            if not done
        ],
    }


def call(db, tenant, user, name, arguments):
    if name not in SCHEMAS:
        raise HTTPException(422, "Herramienta no permitida.")
    body = SCHEMAS[name].model_validate(arguments)
    if name == "get_configuration":
        return configuration(db, tenant)
    if name == "get_sales":
        return reports.sales_summary(db, tenant_id=tenant, **body.model_dump())
    if name == "get_top_products":
        return reports.top_products(db, tenant_id=tenant, limit=5, **body.model_dump())
    if name == "compare_branches":
        result = compare_branches(db, tenant_id=tenant, **body.model_dump()).model_dump(mode="json")
        branches = sorted(result["branches"], key=lambda row: float(row["net_sales"]), reverse=True)
        result["branch_count"] = len(branches)
        result["branches"] = [{k: v for k, v in b.items() if k != "products"} for b in branches[:5]]
        return result
    if name == "get_inventory":
        story = reports.business_story(db, tenant_id=tenant, **body.model_dump())
        return {
            k: v
            for k, v in story.items()
            if k
            in {
                "restock_alerts",
                "recommended_actions",
                "data_quality",
                "inventory_valuation",
                "start_date",
                "end_date",
            }
        }
    if name == "get_catalog":
        return {
            "products": [
                {
                    "id": str(p.id),
                    "name": p.name,
                    "price_amount": str(p.price_amount),
                    "category_id": str(p.category_id) if p.category_id else None,
                    "track_inventory": p.track_inventory,
                    "low_stock_threshold": p.low_stock_threshold,
                }
                for p in db.query(Product)
                .filter_by(tenant_id=tenant, is_active=True)
                .filter(
                    Product.name.ilike("%" + body.query.replace("%", "").replace("_", "") + "%")
                )
                .order_by(Product.name)
                .limit(10)
            ],
            "categories": [
                {"id": str(c.id), "name": c.name}
                for c in db.query(Category)
                .filter_by(tenant_id=tenant, is_active=True)
                .order_by(Category.name)
                .limit(10)
            ],
        }
    if name == "search_knowledge":
        return knowledge.search(db, tenant, user, body.query)
    return [
        {"id": str(r.id), "kind": r.kind, "updated_at": r.updated_at.isoformat(), **r.data}
        for kind in ("memory", "goal")
        for r in repo.records(db, tenant, user, kind, shared=True)
        .filter(
            repo.AssistantRecord.branch_id == active_branch_id(db, tenant)
            if kind == "goal"
            else True
        )
        .populate_existing()
        .limit(5)
        if repo.sources_valid(db, tenant, user, r.data)
    ]
