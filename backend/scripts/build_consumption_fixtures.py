"""Rebuild versioned synthetic CSV examples; never use real account information."""

import csv
import hashlib
import io
import json
import random
from decimal import Decimal
from pathlib import Path

DESTINATION = Path(__file__).resolve().parents[1] / "examples" / "consumption" / "v1"
FIELDS = [
    "transaction_id",
    "account_id",
    "date",
    "amount",
    "currency",
    "counterparty",
    "description",
]


def serialize(rows):
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\n")
    writer.writerow(FIELDS)
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def base_rows():
    rng = random.Random(20261005)
    rows = []
    for month in (7, 8, 9):
        for key, amount, merchant, text in [
            ("rent", -9000, "Demo Condo", "Monthly rent"),
            ("mobile", -300, "Demo AIS", "Mobile plan"),
            ("transport", -1200, "Demo Bus", "Transport pass"),
            ("subscription", -199, "Demo Music", "Music subscription"),
            ("transfer", 15000, "Demo Own Account", "Internal transfer"),
        ]:
            rows.append(
                [
                    f"{month}-{key}",
                    "demo-main",
                    f"2026-{month:02d}-05",
                    f"{amount:.2f}",
                    "THB",
                    merchant,
                    text,
                ]
            )
        for day in range(1, 29):
            rows.append(
                [
                    f"{month}-food-{day}",
                    "demo-main",
                    f"2026-{month:02d}-{day:02d}",
                    f"{-rng.randint(100, 220):.2f}",
                    "THB",
                    "Demo Cafe",
                    "Food and groceries",
                ]
            )
    return rows


def build():
    DESTINATION.mkdir(parents=True, exist_ok=True)
    rows = base_rows()
    fixtures = {
        "history.csv": rows,
        "duplicate.csv": [rows[0]],
        "partial-month.csv": [r for r in rows if r[2] >= "2026-09-15"],
        "refund.csv": [
            [
                "refund-1",
                "demo-main",
                "2026-09-25",
                "50.00",
                "THB",
                "Demo Cafe",
                "Food refund",
            ]
        ],
        "missing-records.csv": [
            rows[0],
            ["invalid", "demo-main", "not-a-date", "-10", "THB", "Demo Cafe", "Food"],
        ],
        "rising-costs.csv": [
            [
                f"{m}-extra-food",
                "demo-main",
                f"2026-{m:02d}-20",
                "-75000.00",
                "THB",
                "Demo Grocery",
                "Food",
            ]
            for m in (7, 8, 9)
        ],
    }
    manifest = {
        "version": "consumption-v1",
        "seed": 20261005,
        "synthetic": True,
        "as_of": "2026-10-01",
        "coverage": {"start": "2026-07-01", "end": "2026-09-30"},
        "files": {},
    }
    for name, items in fixtures.items():
        content = serialize(items)
        (DESTINATION / name).write_bytes(content)
        manifest["files"][name] = {
            "sha256": hashlib.sha256(content).hexdigest(),
            "rows": len(items),
        }
    monthly_food = [
        sum(
            -Decimal(r[3])
            for r in rows
            if r[2].startswith(f"2026-{m:02d}") and "food" in r[0]
        )
        for m in (7, 8, 9)
    ]
    manifest["expected"] = {
        "food_monthly_median": f"{sorted(monthly_food)[1]:.2f}",
        "recurring_categories": ["rent", "mobile", "transport", "subscription"],
        "wallet_change_from_import": "0.00",
        "transfer_is_spending": False,
    }
    (DESTINATION / "manifest.json").write_text(
        json.dumps(manifest, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    build()
