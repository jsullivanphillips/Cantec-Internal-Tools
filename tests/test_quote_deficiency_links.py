from datetime import datetime, timezone


def test_extract_deficiency_ids_from_quote_payload():
    from app.routes.performance_summary import extract_deficiency_ids_from_quote_payload

    payload = {
        "id": 123,
        "serviceRequests": [
            {"id": 1, "deficiency": {"id": 8001}},
            {"id": 2},
            {"id": 3, "deficiency": {"id": 8002}},
        ],
    }

    assert extract_deficiency_ids_from_quote_payload(payload) == {8001, 8002}
    assert extract_deficiency_ids_from_quote_payload({"id": 123}) == set()


def test_quotes_missing_deficiency_links(monkeypatch):
    from app.routes import performance_summary as ps

    linked_quote_ids = {9101}
    rows = [
        (9101, 200),
        (9102, 201),
        (9103, None),
    ]

    monkeypatch.setattr(
        ps.db.session,
        "query",
        lambda *args, **kwargs: type(
            "Q",
            (),
            {
                "distinct": lambda self: self,
                "filter": lambda self, *a, **k: self,
                "all": lambda self: [(quote_id,) for quote_id in linked_quote_ids]
                if args[0] is ps.QuoteDeficiencyLink.quote_id
                else rows,
            },
        )(),
    )

    window_start = datetime(2026, 4, 1, tzinfo=timezone.utc)
    window_end = datetime(2026, 6, 30, 23, 59, 59, tzinfo=timezone.utc)
    missing = ps._quotes_missing_deficiency_links(window_start, window_end)

    assert (9102, 201) in missing
    assert all(row[0] != 9101 for row in missing)
    assert all(row[0] != 9103 for row in missing)


def test_ensure_quote_deficiency_links_upserts_missing_deficiency(monkeypatch):
    from app import create_app
    from app.routes import performance_summary as ps

    app = create_app()
    added: list[tuple[int, int]] = []

    class FakeLinkQuery:
        def __init__(self, quote_id, deficiency_id):
            self.quote_id = quote_id
            self.deficiency_id = deficiency_id

        def first(self):
            if (self.quote_id, self.deficiency_id) in added:
                return object()
            return None

    with app.app_context():
        monkeypatch.setattr(
            ps.db.session,
            "query",
            lambda model: type(
                "Q",
                (),
                {
                    "all": lambda self: [(9001,)]
                    if model is ps.Quote.quote_id
                    else [(8001,)],
                },
            )(),
        )
        monkeypatch.setattr(
            ps,
            "ensure_deficiency_from_st",
            lambda st_def_id: object() if st_def_id == 8001 else None,
        )
        monkeypatch.setattr(
            ps.QuoteDeficiencyLink,
            "query",
            type(
                "LQ",
                (),
                {
                    "filter_by": lambda self, **kwargs: FakeLinkQuery(
                        kwargs["quote_id"], kwargs["deficiency_id"]
                    ),
                },
            )(),
        )
        monkeypatch.setattr(
            ps.db.session,
            "add",
            lambda link: added.append((link.quote_id, link.deficiency_id)),
        )
        monkeypatch.setattr(ps.db.session, "commit", lambda: None)

        added_count = ps.ensure_quote_deficiency_links({9001: {8001}})

    assert added_count == 1
    assert added == [(9001, 8001)]
