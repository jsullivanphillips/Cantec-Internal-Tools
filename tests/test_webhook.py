import json


def _job_status_payload(job_id: int = 999, field: str = "status") -> dict:
    return {
        "data": [
            {
                "entity": {"type": "job", "id": job_id},
                "changeset": {"field": field},
            }
        ]
    }


def test_job_status_webhook_ignores_untracked_jobs_quickly(smoke_client, monkeypatch):
    monkeypatch.setattr("app.routes.webhook._job_has_tracked_deficiencies", lambda _job_id: False)
    deferred: list[str] = []
    monkeypatch.setattr(
        "app.routes.webhook._defer_webhook_task",
        lambda label, _fn: deferred.append(label),
    )

    res = smoke_client.post(
        "/webhooks/job_status_changed",
        data=json.dumps(_job_status_payload(job_id=424242)),
        content_type="application/json",
    )
    assert res.status_code == 200
    assert "no tracked deficiencies" in res.get_json()["message"]
    assert deferred == []


def test_job_status_webhook_queues_tracked_jobs(smoke_client, monkeypatch):
    monkeypatch.setattr("app.routes.webhook._job_has_tracked_deficiencies", lambda _job_id: True)
    deferred: list[str] = []
    monkeypatch.setattr(
        "app.routes.webhook._defer_webhook_task",
        lambda label, _fn: deferred.append(label),
    )

    res = smoke_client.post(
        "/webhooks/job_status_changed",
        data=json.dumps(_job_status_payload(job_id=12345)),
        content_type="application/json",
    )
    assert res.status_code == 200
    assert res.get_json()["queued"] is True
    assert deferred == ["job-status-12345"]


def test_job_status_webhook_ignores_non_status_field(smoke_client):
    res = smoke_client.post(
        "/webhooks/job_status_changed",
        data=json.dumps(_job_status_payload(field="notes")),
        content_type="application/json",
    )
    assert res.status_code == 200
    assert "non-status" in res.get_json()["message"]
