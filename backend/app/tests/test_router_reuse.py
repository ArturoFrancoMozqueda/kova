"""Shared route definitions must preserve per-application security dependencies."""

from fastapi import APIRouter, Depends, FastAPI, HTTPException
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient


def test_reused_router_keeps_dependency_overrides_isolated_between_apps():
    def authorize():
        raise HTTPException(status_code=401, detail="Authentication required")

    router = APIRouter(prefix="/private", dependencies=[Depends(authorize)])

    @router.get("/record")
    def record():
        return {"available": True}

    first, second = FastAPI(), FastAPI()
    first.include_router(router)
    second.include_router(router)
    first.dependency_overrides[authorize] = lambda: None
    # Reusing the definition avoids cloning; authorization belongs to each app.
    included = next(route for route in iter_route_contexts(first.routes) if route.endpoint is record)
    assert included.original_route is router.routes[0]
    with TestClient(first) as first_client, TestClient(second) as second_client:
        assert first_client.get("/private/record").json() == {"available": True}
        denied = second_client.get("/private/record")
        assert denied.status_code == 401
        assert denied.json() == {"detail": "Authentication required"}
        first.dependency_overrides.clear()
        assert first_client.get("/private/record").status_code == 401
