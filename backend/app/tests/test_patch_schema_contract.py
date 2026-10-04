"""PATCH contracts distinguish omitted fields from explicit null values."""

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from app.catalog.schemas import CategoryUpdate, ProductUpdate
from app.expenses.schemas import ExpenseUpdate

PROTECTED_FIELDS = [
    (CategoryUpdate, "name", "Pan"),
    (CategoryUpdate, "sort_order", 3),
    (CategoryUpdate, "is_active", False),
    (ProductUpdate, "name", "Concha"),
    (ProductUpdate, "price_amount", "18.50"),
    (ProductUpdate, "track_inventory", False),
    (ProductUpdate, "image_position_x", 0),
    (ProductUpdate, "image_position_y", 100),
    (ProductUpdate, "image_zoom", 0.5),
    (ProductUpdate, "is_active", False),
    (ExpenseUpdate, "category", "renta"),
    (ExpenseUpdate, "amount", "425.50"),
    (ExpenseUpdate, "expense_date", "2026-07-10"),
]


@pytest.mark.parametrize("model,field,valid_value", PROTECTED_FIELDS)
def test_required_patch_field_schema_matches_omitted_and_null_behavior(model, field, valid_value):
    schema = model.model_json_schema()
    field_schema = schema["properties"][field]
    assert field not in schema.get("required", [])
    assert field_schema.get("type") != "null"
    assert all(branch.get("type") != "null" for branch in field_schema.get("anyOf", []))
    assert "default" not in field_schema

    # ExpenseUpdate requires at least one change; a nullable field provides it
    # while proving every other omitted field stays outside model_fields_set.
    nullable_field = "note" if model is ExpenseUpdate else "description"
    omitted = model.model_validate({nullable_field: None})
    assert field not in omitted.model_fields_set
    assert omitted.model_dump(exclude_unset=True) == {nullable_field: None}
    model.model_validate({field: valid_value})
    with pytest.raises(ValidationError) as exc:
        model.model_validate({field: None})
    assert any(error["loc"] == (field,) for error in exc.value.errors())

    # The checked-in API contract must express the same rules as the request
    # model, including its numeric/length constraints.
    contract = json.loads((Path(__file__).resolve().parents[3] / "specs/openapi.json").read_text())
    published = contract["components"]["schemas"][model.__name__]
    assert field not in published.get("required", [])
    assert published["properties"][field] == field_schema


@pytest.mark.parametrize(
    "model,fields",
    [
        (CategoryUpdate, ("description",)),
        (ProductUpdate, ("description", "sku", "cost_price", "category_id", "low_stock_threshold")),
        (ExpenseUpdate, ("note",)),
    ],
)
def test_nullable_patch_fields_still_advertise_and_accept_null(model, fields):
    schema = model.model_json_schema()
    payload = dict.fromkeys(fields)
    assert model.model_validate(payload).model_dump(exclude_unset=True) == payload
    for field in fields:
        assert {"type": "null"} in schema["properties"][field]["anyOf"]


def test_patch_schema_preserves_money_and_image_constraints():
    product = ProductUpdate.model_json_schema()["properties"]
    expense = ExpenseUpdate.model_json_schema()["properties"]
    assert product["price_amount"]["anyOf"][0]["minimum"] == 0
    assert expense["amount"]["anyOf"][0]["exclusiveMinimum"] == 0
    for field in ("image_position_x", "image_position_y"):
        assert product[field]["minimum"] == 0
        assert product[field]["maximum"] == 100
    assert product["image_zoom"]["minimum"] == 0.5
    assert product["image_zoom"]["maximum"] == 3


@pytest.mark.parametrize(
    "model,payload",
    [
        (CategoryUpdate, {"name": ""}),
        (ProductUpdate, {"price_amount": "-0.01"}),
        (ProductUpdate, {"price_amount": "10000000000.00"}),
        (ProductUpdate, {"price_amount": "18.501"}),
        (ProductUpdate, {"image_position_x": -1}),
        (ProductUpdate, {"image_position_y": 101}),
        (ProductUpdate, {"image_zoom": 3.1}),
        (ExpenseUpdate, {"amount": "0.00"}),
        (ExpenseUpdate, {"amount": "10000000000.00"}),
        (ExpenseUpdate, {"amount": "425.501"}),
    ],
)
def test_patch_runtime_constraints_remain_enforced(model, payload):
    with pytest.raises(ValidationError) as exc:
        model.model_validate(payload)
    field = next(iter(payload))
    assert all(error["loc"] == (field,) for error in exc.value.errors())
