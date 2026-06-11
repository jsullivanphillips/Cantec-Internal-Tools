"""Master sheet ADDRESS block parsing for building_name."""

from app.monthly.route_inspection_csv_import import parse_address_block


def test_parse_address_block_seaport_place_example():
    street, building, company = parse_address_block(
        "9851 Seaport Place\nName: Seaport Place\nManagement: Colliers"
    )
    assert street == "9851 Seaport Place"
    assert building == "Seaport Place"
    assert company == "Colliers"
