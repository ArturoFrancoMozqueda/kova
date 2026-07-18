from typing import Any, Literal

from pydantic import BaseModel


class CatalogImportRow(BaseModel):
    row_number: int
    status: Literal["valid", "error"]
    normalized: dict[str, Any]
    errors: list[str]


class CatalogImportResponse(BaseModel):
    dry_run: bool
    total_rows: int
    valid_rows: int
    error_rows: int
    rows: list[CatalogImportRow]
    created_products: int = 0
    created_categories: int = 0
    initial_stock_movements: int = 0
