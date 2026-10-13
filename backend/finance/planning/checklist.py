"""Arrival checklists seeded once a plan is confirmed.

They are general reminders by destination country, never the school's own notice: dates are offsets from the
programme start and the student fills in or moves them. Items carry no amount, because visa, insurance and
housing costs already arrive as plan bills; counting them here too would double the money check.
"""
from datetime import timedelta

from . import catalog
from .models import StudyTask

# (key, days from the programme start, English, Chinese)
COMMON = [
    ("admission", -120, "Confirm the admission result and accept the offer", "确认录取结果并接受录取"),
    ("documents", -75, "Prepare passport, photos and original transcripts", "准备护照、证件照和成绩单原件"),
]
COUNTRY = {
    "TH": [
        ("visa", -60, "Apply for the Non-Immigrant ED visa", "申请 Non-ED 教育签证"),
        ("housing", -45, "Book housing and pay the deposit", "预订宿舍并支付押金"),
        ("insurance", -30, "Buy or confirm the health insurance the school requires", "购买或确认学校要求的健康保险"),
        ("medical", -30, "Get the medical certificate", "办理体检证明"),
        ("registration", 0, "Register at the university", "到校报到并完成注册"),
        ("report90", 85, "File the 90-day address report with immigration", "向移民局办理 90 天居住报告"),
    ],
    "MY": [
        ("visa", -75, "Get the EMGS visa approval letter (VAL)", "取得 EMGS 签证批准函（VAL）"),
        ("housing", -45, "Book housing and pay the deposit", "预订宿舍并支付押金"),
        ("registration", 0, "Register at the university", "到校报到并完成注册"),
        ("medical", 7, "Complete the EMGS medical screening after arrival", "入境后完成 EMGS 体检"),
    ],
    "GB": [
        ("cas", -90, "Receive the CAS from the university", "取得学校签发的 CAS"),
        ("visa", -60, "Apply for the Student visa and pay the IHS", "申请学生签证并缴纳 IHS 医疗附加费"),
        ("housing", -60, "Book housing and pay the deposit", "预订宿舍并支付押金"),
        ("evisa", -30, "Set up the UKVI account for the eVisa", "开通 UKVI 账户查看 eVisa"),
        ("registration", 0, "Register at the university", "到校报到并完成注册"),
    ],
    "AU": [
        ("coe", -90, "Receive the Confirmation of Enrolment (CoE)", "取得入学确认书（CoE）"),
        ("visa", -60, "Apply for the Student visa (subclass 500)", "申请 500 类学生签证"),
        ("insurance", -60, "Buy Overseas Student Health Cover (OSHC)", "购买海外学生健康保险（OSHC）"),
        ("housing", -45, "Book housing and pay the deposit", "预订宿舍并支付押金"),
        ("registration", 0, "Register at the university", "到校报到并完成注册"),
    ],
    "SG": [
        ("ipa", -60, "Receive the ICA in-principle approval (IPA)", "取得 ICA 原则批准信（IPA）"),
        ("housing", -45, "Book housing and pay the deposit", "预订宿舍并支付押金"),
        ("medical", -30, "Get the medical examination report", "完成体检报告"),
        ("registration", 0, "Register at the university", "到校报到并完成注册"),
        ("pass", 7, "Collect the Student's Pass", "领取学生准证（Student's Pass）"),
    ],
    "JP": [
        ("coe", -90, "Receive the Certificate of Eligibility (CoE)", "取得在留资格认定证明书"),
        ("visa", -45, "Apply for the student visa", "申请留学签证"),
        ("housing", -45, "Book housing and pay the deposit", "预订宿舍并支付押金"),
        ("registration", 0, "Register at the university", "到校报到并完成注册"),
        ("residence", 14, "Register your address and join National Health Insurance", "办理住民登记并加入国民健康保险"),
    ],
}
DEFAULT = [
    ("visa", -60, "Apply for the student visa", "申请学生签证"),
    ("housing", -45, "Book housing and pay the deposit", "预订宿舍并支付押金"),
    ("insurance", -30, "Buy or confirm health insurance", "购买或确认健康保险"),
    ("registration", 0, "Register at the university", "到校报到并完成注册"),
]


def _country(school_key):
    entry = catalog.school(school_key)
    return entry.school.country_code if entry else ""


def items(school_key):
    return COMMON + COUNTRY.get(_country(school_key), DEFAULT)


def title(school_key, key):
    """The bilingual title of a seeded item, or None once the template no longer has it."""
    return next(({"en": en, "zh": zh} for k, _, en, zh in items(school_key) if k == key), None)


def seed(user, plan):
    """Adds the checklist for a newly confirmed plan; items already there (done or not) are kept."""
    have = set(StudyTask.objects.filter(plan=plan).exclude(template_key="").values_list("template_key", flat=True))
    currency = (plan.snapshot or {}).get("currency") or "THB"
    rows = [StudyTask(owner=user, plan=plan, title=en, template_key=key, currency=currency,
                      due_date=plan.start_date + timedelta(days=offset))
            for key, offset, en, _ in items(plan.school_key) if key not in have]
    StudyTask.objects.bulk_create(rows)
    return len(rows)


def clear(plan):
    """A plan reopened for changes drops the open template items; finished ones stay as a record."""
    StudyTask.objects.filter(plan=plan, done=False).exclude(template_key="").delete()
