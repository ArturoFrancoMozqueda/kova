from types import SimpleNamespace

import pytest

from app.workers.bootstrap import environment


def test_versioned_identity_overrides_legacy_metadata_without_changing_credentials():
    sha = "a" * 40
    values = environment(SimpleNamespace(
        APP_ENV="local", KOVA_BUILD_SHA=sha, KOVA_RELEASE_SHA="legacy",
        SECRET_KEY="synthetic-credential",
    ))
    assert values["kova_release_sha"] == sha
    assert values["SECRET_KEY"] == "synthetic-credential"
    assert values["KOVA_RELEASE_SHA"] == "legacy"


def test_legacy_worker_identity_remains_compatible():
    values = environment(SimpleNamespace(APP_ENV="local", KOVA_RELEASE_SHA="legacy"))
    assert values["KOVA_RELEASE_SHA"] == "legacy"
    assert "kova_release_sha" not in values


@pytest.mark.parametrize("value", ["", "short", "z" * 40, 123])
def test_malformed_versioned_identity_fails_closed(value):
    with pytest.raises(RuntimeError, match="complete commit SHA"):
        environment(SimpleNamespace(APP_ENV="local", KOVA_BUILD_SHA=value))
