#!/usr/bin/env python3
"""Fix label=None in MonthlyLocation test fixtures after building->label migration."""

from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "tests"

FILES = [
    "test_monthly_run_details_api.py",
    "test_worksheet_stops_api.py",
    "test_monthly_worksheet_api.py",
]


def fix_file(path: Path) -> None:
    lines = path.read_text(encoding="utf-8").splitlines()
    out: list[str] = []
    i = 0
    changed = 0
    while i < len(lines):
        line = lines[i]
        if "label=None," in line:
            addr = None
            for j in range(i - 1, max(i - 20, -1), -1):
                m = re.search(r'address="([^"]+)"', lines[j])
                if m:
                    addr = m.group(1)
                    break
            if addr:
                out.append(f'        label="{addr}",')
                if i + 1 < len(lines) and 'label_normalized=""' in lines[i + 1]:
                    out.append(f'        label_normalized="{addr.casefold()}",')
                    i += 2
                    changed += 1
                    continue
            changed += 1
            i += 1
            continue
        out.append(line)
        i += 1
    path.write_text("\n".join(out) + "\n", encoding="utf-8")
    print(f"{path.name}: fixed {changed} label=None rows")


def main() -> None:
    for name in FILES:
        fix_file(ROOT / name)


if __name__ == "__main__":
    main()
