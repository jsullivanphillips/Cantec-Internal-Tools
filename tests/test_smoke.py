def test_api_auth_me_without_session(smoke_client):
    r = smoke_client.get("/api/auth/me")
    assert r.status_code == 200
    data = r.get_json()
    assert data is not None
    assert data["authenticated"] is False


def test_api_performance_requires_auth_json(smoke_client):
    r = smoke_client.get("/api/performance/deficiencies")
    assert r.status_code == 401
    data = r.get_json()
    assert data is not None
    assert data.get("code") == "auth_required"


def test_root_returns_spa_or_missing_build(smoke_client):
    r = smoke_client.get("/")
    assert r.status_code in (200, 503)
