"""A deliberately incomplete, source-backed PSU baseline; never invent missing costs."""

from copy import deepcopy
from decimal import Decimal

TEMPLATE_KEY = "psu-phuket-fis-ib-2026-1-shared"
FIS = "https://sites.google.com/phuket.psu.ac.th/fispsuphuket/International-Students"
DORM = "https://www.psu.ac.th/phuket/en/on-campus-accommodation-2/"
CALENDAR = "https://gao.psu.ac.th/admission/academic-calendar"
OBSERVED = "2026-10-05T14:38:06Z"
REQUIRED = [
    "tuition",
    "housing",
    "deposit",
    "food",
    "transport",
    "communications",
    "utilities",
    "insurance",
    "visa",
    "travel",
    "settlement",
]


def item(key, category, amount=None, period="once", source=None, **extra):
    evidence = (
        [
            {
                "source_id": source,
                "field": "amount",
                "quote": format(Decimal(amount), ",.0f"),
                "locator": "TUITION & FEES / B.B.A. International Business"
                if key in {"tuition", "enrollment"}
                else "Dormitory rental rates / International Students",
            }
        ]
        if source and amount
        else []
    )
    return {
        "cost_id": key,
        "category": category,
        "component": key,
        "currency": "THB",
        "evidence": evidence,
        "amount": amount,
        "period": period,
        "due_date": None,
        "paid": None,
        "confidence_type": "UNCONFIRMED",
        "year": 2026,
        "campus": "Phuket",
        "observed_at": OBSERVED if source else None,
        "valid_until": "2026-12-15" if source else None,
        "source_refs": [source] if source else [],
        "synthetic": False,
        **extra,
    }


def get_template(room="shared"):
    single = room == "single"
    costs = [
        item("tuition", "tuition", "41000.00", "semester", FIS),
        item("enrollment", "settlement", "20000.00", source=FIS),
        item(
            "housing", "housing", "22500.00" if single else "11250.00", "semester", DORM
        ),
        item(
            "deposit",
            "deposit",
            source=DORM,
            conflict=True,
            alternatives=[
                {"amount": "6000.00" if single else "3000.00", "source": FIS},
                {"amount": "12000.00" if single else "6000.00", "source": DORM},
            ],
        ),
        item(
            "dorm_card",
            "settlement",
            source=DORM,
            conflict=True,
            alternatives=[
                {"amount": "50.00", "source": FIS},
                {"amount": "100.00", "source": DORM},
            ],
        ),
    ]
    for category in [
        "food",
        "transport",
        "communications",
        "utilities",
        "insurance",
        "visa",
        "travel",
    ]:
        costs.append(
            item(
                category,
                category,
                period="monthly" if category in REQUIRED[3:7] else "once",
            )
        )
    costs.append(item("study_materials", "settlement"))
    return deepcopy(
        {
            "key": TEMPLATE_KEY,
            "version": 1,
            "room": room,
            "synthetic": False,
            "profile": {
                "school": "Prince of Songkla University",
                "campus": "Phuket",
                "city": "Phuket",
                "country": "Thailand",
                "program": "BBA International Business",
                "student_type": "new international undergraduate",
                "semester": "2026/1",
                "lifestyle_profile": "campus_" + room,
                "start_date": "2026-08-10",
                "end_date": "2026-12-15",
                "evidence": [
                    {
                        "source_id": CALENDAR,
                        "field": "start_date",
                        "quote": "10 August 2026",
                        "locator": "Academic Calendar 2026 (Phuket Campus) / First Semester",
                    },
                    {
                        "source_id": CALENDAR,
                        "field": "end_date",
                        "quote": "15 December 2026",
                        "locator": "Academic Calendar 2026 (Phuket Campus) / First Semester",
                    },
                ],
            },
            "costs": costs,
            "reserve": None,
            "required_categories": REQUIRED,
            "sources": [
                {
                    "url": url,
                    "observed_at": OBSERVED,
                    "applicable_academic_year": 2026,
                    "status": "REVIEWED_REFERENCE_NOT_INDIVIDUAL_VERIFICATION",
                }
                for url in [FIS, DORM, CALENDAR]
            ],
            "notes": [
                "Source-backed reference, not an individual invoice or a verified payment obligation.",
                "Deposit/card sources conflict. No reliable local food/transport/mobile estimate is asserted.",
            ],
        }
    )
