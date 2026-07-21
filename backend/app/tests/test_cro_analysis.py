from datetime import UTC, datetime

from scripts.analyze_cro_export import analyze_experiment, render_markdown, wilson_interval


def _row(
    date: str,
    event: str,
    client_id: str,
    *,
    variant: str = "",
    cta: str = "",
    device_class: str = "mobile",
    source: str = "direct",
    medium: str = "none",
) -> dict[str, str]:
    return {
        "date": date,
        "event": event,
        "client_id": client_id,
        "device_class": device_class,
        "viewport_bucket": "mobile_390" if device_class == "mobile" else "desktop",
        "source": source,
        "medium": medium,
        "campaign": "not_set",
        "cta": cta,
        "section": "",
        "experiment_id": "exp_01_cta_specificity" if variant else "",
        "variant": variant,
        "conversion_state": "observed",
    }


def test_analysis_deduplicates_exposure_and_counts_only_post_exposure_outcomes() -> None:
    rows = [
        _row("2026-07-20T09:00:00Z", "landing_cta_clicked", "control-1", cta="hero"),
        _row("2026-07-20T10:00:00Z", "experiment_exposed", "control-1", variant="control"),
        _row("2026-07-20T10:01:00Z", "experiment_exposed", "control-1", variant="control"),
        _row("2026-07-20T10:02:00Z", "landing_cta_clicked", "control-1", cta="hero"),
        _row("2026-07-20T10:03:00Z", "signup_completed", "control-1"),
        _row(
            "2026-07-20T10:00:00Z",
            "experiment_exposed",
            "treatment-1",
            variant="treatment",
            device_class="desktop",
            source="google",
            medium="cpc",
        ),
        _row("2026-07-20T10:02:00Z", "signup_validation_failed", "treatment-1"),
    ]

    result = analyze_experiment(
        rows,
        experiment_id="exp_01_cta_specificity",
        days=7,
        as_of=datetime(2026, 7, 21, tzinfo=UTC),
    )

    assert result["metrics"]["control"]["primary"]["sample"] == 1
    assert result["metrics"]["control"]["primary"]["count"] == 1
    assert result["metrics"]["control"]["signup"]["count"] == 1
    assert result["metrics"]["treatment"]["validation_failure"]["count"] == 1
    assert result["decision"] == "inconclusive_insufficient_sample"
    assert {item["value"] for item in result["segments"]["device_class"]} == {
        "desktop",
        "mobile",
    }
    assert {item["value"] for item in result["segments"]["channel"]} == {
        "direct/none",
        "google/cpc",
    }


def test_analysis_excludes_clients_with_conflicting_variants() -> None:
    rows = [
        _row("2026-07-20T10:00:00Z", "experiment_exposed", "conflict", variant="control"),
        _row("2026-07-20T10:01:00Z", "experiment_exposed", "conflict", variant="treatment"),
    ]

    result = analyze_experiment(
        rows,
        experiment_id="exp_01_cta_specificity",
        days=7,
        as_of=datetime(2026, 7, 21, tzinfo=UTC),
    )

    assert result["conflicting_assignments_excluded"] == 1
    assert result["metrics"]["control"]["primary"]["sample"] == 0
    assert result["metrics"]["treatment"]["primary"]["sample"] == 0


def test_markdown_reports_intervals_segments_and_inconclusive_decision() -> None:
    rows = [
        _row("2026-07-20T10:00:00Z", "experiment_exposed", "control-1", variant="control"),
        _row("2026-07-20T10:00:00Z", "experiment_exposed", "treatment-1", variant="treatment"),
    ]
    result = analyze_experiment(
        rows,
        experiment_id="exp_01_cta_specificity",
        days=7,
        as_of=datetime(2026, 7, 21, tzinfo=UTC),
    )

    report = render_markdown(result)

    assert "95% CI" in report
    assert "device_class" in report
    assert "channel" in report
    assert "inconclusive_insufficient_sample" in report
    low, high = wilson_interval(0, 1)
    assert low == 0
    assert 0 < high < 1
