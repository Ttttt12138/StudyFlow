"""Shared document instruction checks and conservative classification routing."""

import re

SUSPICIOUS = (
    r"ignore (?:previous|all|prior) instructions|transfer all funds|system prompt|override.*policy|忽略.*指令|绕过.*政策|转出全部资金|全部资金转入"
)
RECEIPT = r"(?:embedded|attached).{0,35}(?:receipt|payload)|(?:内嵌|嵌入|附件|附带).{0,15}(?:回执|凭证)"
AUTHORITY = r"authenticat|authoriz|认证|授权"
ACTION = r"(?:execute|make).{0,30}payment|(?:skip|bypass).{0,25}confirm|without.{0,35}confirm|跳过.{0,15}确认|执行.{0,10}付款|直接支付"
NEGATIVE = r"^\s*(?:never\b|do not\b|don't\b|不得|不要|禁止|不能)"


def untrusted_instructions(text):
    if re.search(SUSPICIOUS, text, re.I):
        return True
    clauses = re.split(r"[.!?。！？\n]", text)
    positive = " ".join(c for c in clauses if not re.search(NEGATIVE, c, re.I))
    return all(re.search(pattern, positive, re.I) for pattern in (RECEIPT, AUTHORITY, ACTION))


def safe_payment_conflict(judgment):
    return bool(judgment and judgment.instruction_risk is not None
                and judgment.instruction_risk < 0.5
                and judgment.payment_conflict is not None and judgment.payment_conflict >= 0.5)


def blocks_extraction(judgment):
    if judgment is None:
        return True
    if judgment.instruction_risk is not None and judgment.instruction_risk >= 0.5:
        return True
    return judgment.anomaly >= 0.5 and not safe_payment_conflict(judgment)
