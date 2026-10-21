"""A resident listener must expose ready dependency graphs for every area."""

from unittest.mock import Mock

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.native_checks import prepare_native_routes


class PreparedResponse(BaseModel):
    value: int


def test_native_preparation_materializes_all_areas_without_executing_dependencies(monkeypatch):
    import fastapi.routing

    guard = Mock()

    def protected():
        guard()
        raise HTTPException(status_code=401, detail="Authentication required")

    application = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    for area in ("catalog", "reports", "purchasing"):
        router = APIRouter(prefix=f"/{area}")

        @router.get("/items", response_model=PreparedResponse, dependencies=[Depends(protected)])
        def items():
            raise AssertionError("Protected endpoints must not execute")

        application.include_router(router)

    prepare_native_routes(application)
    guard.assert_not_called()
    assert set(application.openapi_schema["paths"]) == {
        "/catalog/items", "/reports/items", "/purchasing/items",
    }
    assert application.docs_url is application.redoc_url is application.openapi_url is None

    # The first real request to every area must reuse the already prepared
    # route graph, while preserving its authentication dependency.
    populate = Mock(side_effect=AssertionError("Request compiled a deferred route graph"))
    monkeypatch.setattr(fastapi.routing, "_populate_api_route_state", populate)
    with TestClient(application) as client:
        for area in ("catalog", "reports", "purchasing"):
            response = client.get(f"/{area}/items")
            assert response.status_code == 401
            assert response.json() == {"detail": "Authentication required"}
        assert client.get("/docs").status_code == 404
        assert client.get("/openapi.json").status_code == 404
    assert guard.call_count == 3
    populate.assert_not_called()
