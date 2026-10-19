from sqlalchemy import text

from app.tests.test_reconciliation import csv_content, imported, setup


def test_import_replay_is_canonical_under_mexico_database_timezone(client, db):
    db.execute(text("SET LOCAL TIME ZONE 'America/Mexico_City'"))
    setup(client, db)
    first, payload = imported(client, csv_content())
    assert first.status_code == 200, first.text
    assert first.json()["created_at"].endswith("Z")
    duplicate = client.post("/api/v1/reconciliation/imports/commit", json=payload,
                            headers={"Idempotency-Key": "same-import-another-request"})
    assert duplicate.status_code == 200, duplicate.text
    assert duplicate.json() == first.json()
