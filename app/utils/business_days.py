from datetime import date, timedelta


def business_days_between(start: date, end: date) -> int:
    """
    Count Monday–Friday calendar days strictly after ``start`` through ``end`` inclusive.
  """
    if end <= start:
        return 0
    count = 0
    current = start + timedelta(days=1)
    while current <= end:
        if current.weekday() < 5:
            count += 1
        current += timedelta(days=1)
    return count
