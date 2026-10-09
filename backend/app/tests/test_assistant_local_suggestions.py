"""Suggested local questions must work without configuring or spending on AI."""

import pytest

from app.assistant import budget, generation, provider
from app.tests.test_assistant_groq import enabled_client as _enabled_client
from app.tests.test_assistant_groq import running_job

enabled_client = _enabled_client

pytestmark = pytest.mark.usefixtures("fast_business_auth")


@pytest.mark.parametrize("content", [
    "Revisa mis ventas de este mes",
    "¿Qué productos debo reponer?",
    "¿Dónde configuro el ticket?",
    "¿Cómo importar mi catálogo?",
    "¿Cómo registrar una venta?",
    "¿Cómo cerrar un turno?",
])
def test_local_suggested_questions_complete_without_inference(enabled_client, monkeypatch, content):
    _, db, tenant, _ = enabled_client
    ctx, job = running_job(db, tenant, content)
    monkeypatch.setattr(provider, "ready", lambda: False)
    monkeypatch.setattr(provider, "generate", lambda *a, **kw: pytest.fail("No inference"))
    monkeypatch.setattr(budget, "reserve", lambda *a, **kw: pytest.fail("No model quota"))
    generation.run(db, ctx, job)
    assert job.status == "completed"
    assert job.data["response_mode"] == "direct"
    assert job.data["proposal_id"] is None
