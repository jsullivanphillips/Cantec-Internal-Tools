from app.monthly.location_display import short_street_address
from app.scripts.fix_months_on_invoice_location_labels import (
    billing_comments_for_months_on_invoice,
    parse_months_on_invoice_label,
    plan_location_fix,
)


class _Loc:
    def __init__(
        self,
        *,
        id: int,
        label: str,
        address: str,
        display_address: str | None = None,
        billing_comments: str | None = None,
        address_normalized: str | None = None,
        property_management_company_normalized: str = "",
    ):
        self.id = id
        self.label = label
        self.address = address
        self.display_address = display_address
        self.billing_comments = billing_comments
        self.address_normalized = address_normalized or address.casefold()
        self.property_management_company_normalized = property_management_company_normalized


def test_short_street_address_abbreviates_suffix():
    assert short_street_address("800 Johnson Street") == "800 Johnson St"
    assert short_street_address("9851 Seaport Place, Victoria, BC") == "9851 Seaport Pl"


def test_parse_months_on_invoice_label_variants():
    assert parse_months_on_invoice_label("Months on invoice") == (True, None)
    assert parse_months_on_invoice_label("Months on invoices") == (True, None)
    assert parse_months_on_invoice_label("532 & 536 Herald Street Months on invoice") == (True, None)
    assert parse_months_on_invoice_label("2644 Prior Street Months on invoices $55 after June 2025") == (
        True,
        "$55 after June 2025",
    )
    assert parse_months_on_invoice_label("1035 Belmont Avenue") == (False, None)


def test_billing_comments_for_months_on_invoice():
    assert billing_comments_for_months_on_invoice(None, None) == "Months on invoice"
    assert billing_comments_for_months_on_invoice("Credit from QB", None) == "Months on invoice\nCredit from QB"
    assert billing_comments_for_months_on_invoice("Months on invoice", None) == "Months on invoice"
    assert (
        billing_comments_for_months_on_invoice("Months on invoice", "$55 after June 2025")
        == "Months on invoice\n$55 after June 2025"
    )


def test_plan_location_fix_uses_short_address_label(monkeypatch):
    loc = _Loc(id=450, label="Months on invoice", address="532 & 536 Herald Street")
    monkeypatch.setattr(
        "app.scripts.fix_months_on_invoice_location_labels._unique_conflict",
        lambda _loc, _label: None,
    )
    plan = plan_location_fix(loc)
    assert plan.status == "update_candidate"
    assert plan.new_label == "532 & 536 Herald St"
    assert plan.new_billing_comments == "Months on invoice"
