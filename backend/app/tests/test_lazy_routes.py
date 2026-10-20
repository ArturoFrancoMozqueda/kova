"""Worker routing defers unrelated declarations, never route security."""

from importlib import import_module

import pytest
from fastapi.routing import iter_route_contexts
from fastapi.testclient import TestClient

from app import main
from app.route_registry import ROUTERS, LazyRoutes, include_routes


def test_registry_covers_every_route_and_keeps_the_full_openapi_contract():
    reference = main._construct_app()
    for module, prefixes in ROUTERS:
        router = import_module(module).router
        # A router with lifecycle hooks must not silently become request-loaded.
        assert not router.on_startup and not router.on_shutdown
        for route in iter_route_contexts(router.routes):
            assert any(
                route.path == prefix or route.path.startswith(prefix + "/")
                for prefix in prefixes
            ), (module, route.path)
    for route in iter_route_contexts(reference.routes):
        if route.path in {"/", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect"}:
            continue
        assert any(
            route.path == prefix or route.path.startswith(prefix + "/")
            for _, prefixes in ROUTERS for prefix in prefixes
        ), route.path
    lazy = main._construct_app(lazy_routes=True)
    assert not getattr(lazy.state, "loaded_router_modules", set())
    include_routes(lazy)
    assert lazy.openapi() == reference.openapi()
    assert [m.cls for m in lazy.user_middleware] == [m.cls for m in reference.user_middleware]


def test_selected_routes_reuse_original_definitions_and_inherited_guards():
    reference = {(r.path, frozenset(r.methods or [])): r for r in iter_route_contexts(main._construct_app().routes)}
    app = main._construct_app(lazy_routes=True)
    include_routes(app, "/api/v1/internal/ops/mfa/status")
    assert app.state.loaded_router_modules == {"app.ops.router", "app.ops.mfa_router"}
    for route in iter_route_contexts(app.routes):
        assert route.original_route is reference[(route.path, frozenset(route.methods or []))].original_route or route.path in {
            "/", "/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect",
        }
    before = len(app.routes)
    include_routes(app, "/api/v1/internal/ops/mfa/status/")
    assert len(app.routes) == before


def test_lazy_dispatch_keeps_anonymous_and_cross_domain_authorization_closed():
    app = main._construct_app(lazy_routes=True)
    with TestClient(LazyRoutes(app)) as client:
        assert client.get("/api/v1/auth/session").json()["authenticated"] is False
        assert app.state.loaded_router_modules == {"app.auth.router"}
        for path in ["/api/v1/catalog/products", "/api/v1/inventory/stock", "/api/v1/orders"]:
            assert client.get(path).status_code == 401
        assert client.get("/api/v1/authentication/session").status_code == 404
        assert "app.reports.router" not in app.state.loaded_router_modules


@pytest.mark.parametrize("guard", ["_validate_config", "assert_rls_active", "assert_private_policies"])
def test_lazy_creation_still_aborts_on_every_security_guard(monkeypatch, guard):
    failure = RuntimeError("blocked")

    def reject(*args, **kwargs):
        raise failure

    monkeypatch.setattr(main, guard, reject)
    monkeypatch.setattr(main, "_construct_app", lambda **kwargs: pytest.fail("guard bypassed"))
    with pytest.raises(RuntimeError) as caught:
        main.create_app(lazy_routes=True)
    assert caught.value is failure
