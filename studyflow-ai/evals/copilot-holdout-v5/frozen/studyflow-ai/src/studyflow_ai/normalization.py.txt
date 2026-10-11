import re
from datetime import date
from decimal import Decimal

from studyflow_ai.models import money

MONTHS = {
    name.lower(): index
    for index, name in enumerate(
        (
            "January",
            "February",
            "March",
            "April",
            "May",
            "June",
            "July",
            "August",
            "September",
            "October",
            "November",
            "December",
        ),
        1,
    )
}


def parse_money(text):
    if not re.fullmatch(r"[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?", text.strip()):
        raise ValueError("Invalid monetary notation")
    return money(Decimal(text.replace(",", "")))


def date_in_quote(value: date, quote: str):
    if value.isoformat() in quote:
        return True
    matches = re.findall(r"\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?[,]?\s+(\d{4})\b", quote)
    matches += [
        (month, day, year)
        for day, month, year in re.findall(r"\b(\d{1,2})\s+([A-Za-z]+)[,]?\s+(\d{4})\b", quote)
    ]
    return any(
        (int(year), MONTHS.get(month.lower(), 0), int(day)) == (value.year, value.month, value.day)
        for month, day, year in matches
    )
