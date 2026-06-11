from pathlib import Path
content = open("app/monthly/legacy_orm_migration.py", encoding="utf-8").read()
# normalize newlines
lines = [ln for ln in content.splitlines() if ln.strip() or ln == ""]
# remove duplicate blank lines
out = []
prev_blank = False
for ln in lines:
    blank = not ln.strip()
    if blank and prev_blank:
        continue
    out.append(ln)
    prev_blank = blank
text = "\n".join(out) + "\n"
text = text.replace("class MonthlyLocationQuarterBilled", "class LegacyMonthlyLocationQuarterBilled")
text = text.replace("class MonthlyLocationTicket", "class LegacyMonthlyLocationTicket")
Path("app/monthly/legacy_orm_migration.py").write_bytes(text.encode("utf-8"))
print("normalized", len(text))
