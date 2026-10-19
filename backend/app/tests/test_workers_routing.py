from app.workers.routing import coordinator_shard


def test_dependent_dashboard_reads_share_the_authenticated_bootstrap_coordinator():
    for cookie in (None, "", "synthetic-routing-cookie-0", "synthetic-routing-cookie-1"):
        shard = coordinator_shard(cookie, "/api/v1/auth/session")
        for path in (
            "/api/v1/auth/refresh", "/api/v1/auth/logout",
            "/api/v1/settings/business-profile", "/api/v1/reports/business-story",
            "/api/v1/reports/sales-summary", "/api/v1/reports/sales-by-hour",
        ):
            assert coordinator_shard(cookie, path) == shard
            assert coordinator_shard(cookie, path + "/") == shard


def test_cookie_groups_use_the_existing_pool_and_keep_other_reads_parallel():
    groups = set()
    for index in range(128):
        cookie = f"synthetic-routing-cookie-{index}"
        critical = coordinator_shard(cookie, "/api/v1/auth/session")
        groups.add(critical)
        lanes = {coordinator_shard(cookie, path) for path in (
            "/api/v1/catalog/products", "/api/v1/inventory/stock",
            "/api/v1/employees", "/api/v1/billing/subscription", "/api/v1/branches",
        )}
        assert len(lanes) >= 2
        assert all(critical < lane < critical + 4 and 0 <= lane < 16 for lane in lanes)
    assert groups == {0, 4, 8, 12}
