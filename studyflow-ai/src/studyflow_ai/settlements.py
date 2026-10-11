"""Explicit settlement components are evidence, not independent obligations."""

import re
from decimal import Decimal

MONEY = r"(THB|USD|EUR)\s*([\d,]+(?:\.\d+)?)"
CHARGE = re.compile(r"(?:import charge|购电(?:费用|费)|购电金额)\s*[:：]?\s*" + MONEY, re.I)
CREDIT = re.compile(r"(?:export credit|售电抵扣|抵扣金额)\s*[:：]?\s*" + MONEY, re.I)
NET = re.compile(r"(?:net payable|净应付(?:款|金额)?|应付净额)\s*[:：]?\s*" + MONEY, re.I)
COMPONENT = re.compile(r"calculation components|not separate payments|计算分项|非独立付款", re.I)


def _money(match):
    return match[1].upper(), Decimal(match[2].replace(",", ""))


def settlement_lines(text):
    """Return suppressed component lines and inconsistent net lines (one-based)."""
    components, mismatches, pending = set(), set(), []
    for index, line in enumerate(text.splitlines(), 1):
        charge, credit, net = CHARGE.search(line), CREDIT.search(line), NET.search(line)
        if net:
            _check_total(pending, net, index, mismatches)
            pending = []
        elif charge or credit:
            if re.search(r"\bdue\b|付款日|到期|invoice", line, re.I) and not COMPONENT.search(line):
                pending = []
                continue  # A separately dated obligation is not a calculation row.
            if (charge and credit) or COMPONENT.search(line) or (credit and pending):
                components.add(index)
                components.update(i for i, _ in pending)
                pending.extend((index, m) for m in (charge, credit) if m)
            elif charge:
                pending = [(index, charge)]
        elif line.strip() and not COMPONENT.search(line):
            pending = []  # Never carry a calculation across a separate bill/header.
    return components, mismatches


def _check_total(pending, net, index, mismatches):
    if len(pending) != 2:
        return
    (currency, charge), (credit_currency, credit) = (_money(m) for _, m in pending)
    net_currency, amount = _money(net)
    if currency != credit_currency or currency != net_currency or charge - credit != amount:
        mismatches.add(index)


def mask_components(text):
    components, _ = settlement_lines(text)
    return "\n".join("" if i in components else line
                     for i, line in enumerate(text.splitlines(), 1))
