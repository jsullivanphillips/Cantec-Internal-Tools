import re
from pathlib import Path

path = Path("app/monthly/legacy_orm_migration.py")
text = path.read_text(encoding="utf-8")
text = re.sub(r"\nclass LegacyMonthlyLocationQuarterBilled.*?(?=\nclass |\Z)", "\n", text, flags=re.S)
text = re.sub(r"\nclass LegacyMonthlyLocationTicket.*?(?=\nclass |\Z)", "\n", text, flags=re.S)
text = re.sub(r"\nclass MonthlyRouteWorksheetAuditEvent.*", "\n", text, flags=re.S)
lines = text.splitlines()
out: list[str] = []
for ln in lines:
    if not ln.strip() and out and not out[-1].strip():
        continue
    out.append(ln.rstrip())
path.write_text("\n".join(out) + "\n", encoding="utf-8")
print("done", len(out))
