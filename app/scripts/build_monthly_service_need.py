# scripts/build_monthly_service_need.py
import argparse
import logging
from datetime import datetime, date, timezone
from typing import Dict, Any, List, Optional

from app import create_app
from app.db_models import (
    db, FactServiceEvent, FactMonthlyServiceNeed,
    DimDate
)
from sqlalchemy import text
from sqlalchemy.dialects.postgresql import insert

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger("build_fmsn")


BASE_SQL = """
WITH events AS (
  SELECT
    f.location_pk,
    f.service_id,
    d.month_start,
    COALESCE(f.hours_actual, f.hours_booked, f.hours_estimated) AS hours_best,
    CASE
      WHEN f.hours_actual    IS NOT NULL THEN 3
      WHEN f.hours_booked    IS NOT NULL THEN 2
      WHEN f.hours_estimated IS NOT NULL THEN 1
      ELSE 0
    END AS quality_rank,
    s.priority AS evidence_priority,
    CASE WHEN s.source_kind IN ('HISTORICAL_JOB','SCHEDULED_JOB') THEN 1 ELSE 0 END AS booked_flag
  FROM fact_service_event f
  JOIN dim_date d   ON d.id = f.date_id
  JOIN dim_source s ON s.id = f.source_id
  WHERE COALESCE(f.hours_actual, f.hours_booked, f.hours_estimated) IS NOT NULL
  {EVENT_FILTERS}
),
ranked AS (
  SELECT
    location_pk,
    service_id,
    month_start,
    hours_best,
    evidence_priority,
    COUNT(*) OVER (PARTITION BY location_pk, service_id, month_start) AS events_count,
    MAX(booked_flag) OVER (PARTITION BY location_pk, service_id, month_start) AS is_booked,
    ROW_NUMBER() OVER (
      PARTITION BY location_pk, service_id, month_start
      ORDER BY evidence_priority DESC, quality_rank DESC
    ) AS rn
  FROM events
)
SELECT
  location_pk,
  service_id,
  month_start,
  hours_best      AS hours_needed,
  evidence_priority,
  is_booked,
  events_count
FROM ranked
WHERE rn = 1
"""

def parse_month(s: str) -> date:
    # "YYYY-MM" -> first day of that month
    dt = datetime.strptime(s, "%Y-%m")
    return date(dt.year, dt.month, 1)

def month_range(start_ms: date, end_ms: date) -> (date, date):
    if end_ms < start_ms:
        raise ValueError("--end must be >= --start")
    return start_ms, end_ms

def build_sql_and_params(
    month: Optional[str],
    start_month: Optional[str],
    end_month: Optional[str],
    location_pks: Optional[List[int]],
    service_ids: Optional[List[int]],
) -> (str, Dict[str, Any]):
    filters = []
    params: Dict[str, Any] = {}

    # Month filters (on events’ d.month_start)
    if month:
        ms = parse_month(month)
        filters.append("AND d.month_start = :ms_eq")
        params["ms_eq"] = ms
    elif start_month or end_month:
        if not (start_month and end_month):
            raise SystemExit("When using --start or --end, you must provide both.")
        ms_start = parse_month(start_month)
        ms_end = parse_month(end_month)
        ms_start, ms_end = month_range(ms_start, ms_end)
        filters.append("AND d.month_start BETWEEN :ms_start AND :ms_end")
        params["ms_start"] = ms_start
        params["ms_end"] = ms_end

    # Location filter
    if location_pks:
        filters.append("AND f.location_pk = ANY(:loc_list)")
        params["loc_list"] = location_pks

    # Service filter
    if service_ids:
        filters.append("AND f.service_id = ANY(:svc_list)")
        params["svc_list"] = service_ids

    event_filters = "\n  " + "\n  ".join(filters) if filters else ""
    sql = BASE_SQL.replace("{EVENT_FILTERS}", event_filters)
    return sql, params

def ensure_month_dimdate_rows(month_starts: List[date]) -> Dict[date, int]:
    # Map month_start date -> dim_date.id (we store the month row as a date record)
    existing = {
        d.d: d.id
        for d in db.session.query(DimDate).filter(DimDate.d.in_(month_starts)).all()
    }
    missing = [ms for ms in month_starts if ms not in existing]
    if missing:
        new_rows = []
        for ms in missing:
            new_rows.append(DimDate(
                d=ms,
                day=ms.day, month=ms.month, year=ms.year,
                quarter=((ms.month - 1)//3) + 1,
                month_start=ms,
                month_name=ms.strftime("%B"),
                week_of_year=int(ms.strftime("%U")),
                is_month_start=True,
                is_month_end=False,
            ))
        if new_rows:
            db.session.bulk_save_objects(new_rows)
            db.session.flush()
            existing.update({row.d: row.id for row in new_rows})
    return existing

def upsert_monthly_rows(sql: str, params: Dict[str, Any]) -> int:
    conn = db.session.connection()
    result = conn.execute(text(sql), params)
    rows = list(result.mappings())
    if not rows:
        log.info("No candidate rows found; nothing to upsert.")
        return 0

    # Prepare month_id map
    month_starts = sorted({r["month_start"] for r in rows})
    month_map = ensure_month_dimdate_rows(month_starts)

    now = datetime.now(timezone.utc)
    upserts = 0
    for r in rows:
        stmt = insert(FactMonthlyServiceNeed).values(
            month_id = month_map[r["month_start"]],
            location_pk = r["location_pk"],
            service_id = r["service_id"],
            hours_needed = r["hours_needed"],
            is_booked = bool(r["is_booked"]),
            evidence_level = int(r["evidence_priority"]),
            events_count = int(r["events_count"]),
            last_computed_at = now,
        ).on_conflict_do_update(
            index_elements=[FactMonthlyServiceNeed.month_id,
                            FactMonthlyServiceNeed.location_pk,
                            FactMonthlyServiceNeed.service_id],
            set_={
                "hours_needed": r["hours_needed"],
                "is_booked": bool(r["is_booked"]),
                "evidence_level": int(r["evidence_priority"]),
                "events_count": int(r["events_count"]),
                "last_computed_at": now,
            }
        )
        db.session.execute(stmt)
        upserts += 1

    db.session.commit()
    return upserts

def main():
    parser = argparse.ArgumentParser(description="Build/refresh fact_monthly_service_need from fact_service_event")
    # Month filters
    parser.add_argument("--month", help="Build a single month: YYYY-MM")
    parser.add_argument("--start", dest="start_month", help="Start month inclusive: YYYY-MM")
    parser.add_argument("--end", dest="end_month", help="End month inclusive: YYYY-MM")
    # Optional entity filters
    parser.add_argument("--location-pk", type=int, action="append",
                        help="Limit to location PK(s) (repeatable). Example: --location-pk 12 --location-pk 34")
    parser.add_argument("--service-id", type=int, action="append",
                        help="Limit to dim_service.id(s) (repeatable). Example: --service-id 1 --service-id 3")
    parser.add_argument("--quiet", action="store_true")
    args = parser.parse_args()

    app = create_app()
    with app.app_context():
        sql, params = build_sql_and_params(
            month=args.month,
            start_month=args.start_month,
            end_month=args.end_month,
            location_pks=args.location_pk,
            service_ids=args.service_id,
        )
        count = upsert_monthly_rows(sql, params)
        if not args.quiet:
            log.info("Upserted %s monthly rows into fact_monthly_service_need", count)

if __name__ == "__main__":
    main()


# # Rebuild exactly March 2025
# python scripts/build_monthly_service_need.py --month 2025-03

# # Rebuild a range (Q1 2025)
# python scripts/build_monthly_service_need.py --start 2025-01 --end 2025-03

# # Rebuild only for two locations (by internal PK)
# python scripts/build_monthly_service_need.py --month 2025-03 --location-pk 12 --location-pk 34

# # Rebuild for two specific services
# python scripts/build_monthly_service_need.py --start 2025-04 --end 2025-06 --service-id 1 --service-id 2
