"""Expose reused mechanisms; text similarity is a review aid, never independence proof."""
import re
from difflib import SequenceMatcher


def normalized(text):
    return re.sub(r"\s+", " ", re.sub(r"\d+(?:[.,-]\d+)*", "#", text.casefold())).strip()


def mechanisms(text):
    lower = text.casefold()
    rules = {
        "water_nonpayment_cutoff": r"(?=.*(?:water|水费|水务))(?=.*(?:suspend|停水|停供))(?=.*(?:unpaid|未缴|未付))",
        "blanket_instruction_takeover": r"ignore.{0,35}instructions|override.{0,30}policy|忽略.{0,12}指令|transfer all funds|full wallet balance|转出全部资金",
        "missing_calendar_year": r"no year|year.{0,15}(?:not|unreadable)|no full due date|年份缺失|未注明年份|未注明年",
        "payment_on_collection": r"pay on delivery|payable when you collect|payment collected on pickup|取货时付款|取餐",
        "pending_sponsor_promise": r"not received|not cash received|no receipt yet|尚未到账|未到账|nothing.{0,10}(?:arrived|received)",
    }
    return sorted(name for name, pattern in rules.items() if re.search(pattern, lower, re.DOTALL))


def audit_families(cases, old):
    """Compare every distinct language template, including the clause-level mechanisms."""
    historical = list({(r["family"], normalized(r["text"])): r for r in old}.values())
    output = []
    for family in dict.fromkeys(c["family"] for c in cases):
        samples = list({(c["language"], normalized(c["text"])): c for c in cases if c["family"] == family}.values())
        comparisons = []
        for sample in samples:
            matches = sorted(historical, key=lambda r: SequenceMatcher(
                None, normalized(sample["text"]), normalized(r["text"]), autojunk=False,
            ).ratio(), reverse=True)[:3]
            shared = set(mechanisms(sample["text"]))
            comparisons.append({"case_id": sample["case_id"], "language": sample["language"],
                "new_text": sample["text"], "mechanisms": sorted(shared),
                "shared_mechanism_families": sorted({r["family"] for r in historical if shared & set(mechanisms(r["text"]))}),
                "nearest": [{"family": r["family"], "case_id": r["case_id"], "text": r["text"]} for r in matches]})
        output.append({"family": family, "status": "pending_human_semantic_review", "comparisons": comparisons})
    return output
