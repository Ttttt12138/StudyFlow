"""Continuous product narrative, with sentence anchors for the accepted 46 shots."""

# Each tuple is (shot number, displayed English, local tempo). All sentences in a
# chapter are synthesized together; tempo changes happen in existing pauses.
CHAPTERS = [
    ("The whole journey", [
        (1, "Before studying abroad, every student faces the same question: can I afford the whole journey? This is StudyFlow.", 1.20),
    ]),
    ("Understand the full cost", [
        (2, "Your first answer brings tuition, living costs and essential expenses into one full-course total.", 1.20),
        (3, "Each line distinguishes sourced fees from estimates, so you can see what the total depends on.", 1.20),
        (4, "With four universities side by side, course length and total cost become easier to compare.", 1.20),
        (5, "The same comparison is available in Thai baht and Chinese yuan,", 1.20),
        (6, "or US dollars, using reference exchange rates.", 1.20),
    ]),
    ("Connect costs to funding", [
        (7, "Your declared savings carry into a saved plan, making the funding gap clear. The borrowing ceiling is simulated, not a bank offer.", 1.20),
        (8, "If an assumption changes, updating one fee revises the estimate.", 1.20),
        (9, "The forecast then connects those costs to payment dates and sources.", 1.20),
        (10, "For the gap that remains, custom and commercial loan examples show different repayment paths.", 1.20),
        (11, "One defers principal during study, with the full schedule available.", 1.20),
        (12, "Here, we choose twenty thousand baht over sixty months, with principal and interest paid from the start.", 1.12),
    ]),
    ("Turn a plan into an agreement", [
        (13, "Once the student confirms the plan, it becomes a simulated loan application.", 1.20),
        (14, "The checklist records demo declarations; it does not verify uploaded documents.", 1.20),
        (15, "A separate signing step makes consent and the school recipient explicit.", 1.20),
        (16, "The signed agreement schedules payments directly to the school's account, verified within this simulation, without adding loan funds to the student's wallet.", 1.20),
    ]),
    ("Bring family support into the plan", [
        (17, "Family support covers another part of the plan: first-month housing.", 1.20),
        (18, "A private link lets a family member confirm the promise, while the wallet stays unchanged.", 1.20),
        (19, "Only when the operator records a simulated receipt does the wallet gain six thousand five hundred baht.", 1.12),
    ]),
    ("Get ready for arrival", [
        (20, "Preparation stays in the same conversation. A dated reminder can be acknowledged, then completed.", 1.20),
        (21, "When registration is finished, the student explicitly confirms enrollment.", 1.20),
        (22, "That opens daily-life tools; the date alone neither enrolls the student nor pays a bill.", 1.20),
    ]),
    ("Make everyday spending simple", [
        (23, "A monthly budget of six thousand baht keeps upcoming payments and shortfalls in view.", 1.12),
        (24, "Just tell StudyFlow what you spent on lunch. It records the expense and updates your remaining budget.", 1.20),
        (25, "Made a mistake? Undoing the entry restores the budget immediately.", 1.20),
    ]),
    ("Stay in control of money", [
        (26, "Separate currency balances make spending easier to follow. All funds shown here come from simulated top-ups and receipts.", 1.20),
        (27, "For an exchange, the assistant compares quotes and prepares a proposal, awaiting your approval.", 1.20),
        (28, "A wrong password stops the action and leaves balances unchanged.", 1.20),
        (29, "With the correct password and confirmation, five hundred yuan is converted into baht.", 1.12),
        (30, "The same principle applies to remittances: routes, fees and arrival estimates come before commitment.", 1.20),
        (31, "Once confirmed, the transfer debits the source balance and creates an order you can track.", 1.20),
    ]),
    ("Pay the right bill once", [
        (32, "When tuition is due, the Pay tab separates your own bills from those covered by the loan.", 1.20),
        (33, "A visible shortfall leads to a top-up for exactly the missing amount.", 1.20),
        (34, "Reviewing the payee and entering the password authorizes payment.", 1.20),
        (35, "The bill is marked paid, while a loan-covered bill is protected against a duplicate charge.", 1.20),
    ]),
    ("Keep repayment visible", [
        (36, "Repayment follows the same consent flow. We advance the demo date, then authorize the first installment with a password.", 1.20),
        (37, "The paid installment appears in the loan history.", 1.20),
        (38, "For smaller bills, the fixed demo credit line provides funds repayable within thirty days.", 1.12),
        (39, "Repaying that credit requires a password and debits the simulated wallet.", 1.20),
        (40, "The available line is restored, with an on-time record when repayment meets the due date.", 1.20),
    ]),
    ("Make trust inspectable", [
        (41, "These safeguards also set boundaries. An over-limit transfer is blocked without operator approval, even with the correct password.", 1.20),
        (42, "The audit trail records authorization attempts and completed actions.", 1.20),
        (43, "Eligible payments build StudyFlow's internal on-time record, rather than an external credit score.", 1.20),
        (44, "A signed statement can be checked by a separate visitor without logging in.", 1.20),
        (45, "Changing its contents makes verification fail.", 1.20),
    ]),
    ("Clear costs. User control.", [
        (46, "From the first cost comparison to student life, StudyFlow keeps decisions connected: live AI proposes, the server enforces, and the student authorizes.", 1.20),
    ]),
]

TITLES = [
    "Your study journey, connected", "One full-course total", "Transparent assumptions",
    "Four schools, one view", "Costs in your currency", "A shared comparison",
    "Known funds, clear gap", "Flexible estimates", "Costs mapped to dates",
    "Repayment choices", "Support during study", "A plan for repayment",
    "Your confirmed application", "Clear document status", "Consent before signing",
    "Funding goes to the school", "Support from family", "A promise stays a promise",
    "Receipt updates the wallet", "Preparation in one place", "Enrollment by confirmation",
    "Ready for student life", "A budget you can follow", "Lunch, recorded naturally",
    "An easy correction", "Balances by currency", "A proposal before an exchange",
    "A wrong password stops here", "An authorized conversion", "Routes before commitment",
    "A transfer you can track", "A clear tuition shortfall", "Exactly the missing amount",
    "Consent before payment", "A bill paid once", "Repayment under your control",
    "A visible repayment history", "Credit for smaller bills", "Repayment from the wallet",
    "Available credit restored", "Limits enforced by the server", "A traceable activity record",
    "Your internal on-time record", "A statement anyone can check", "Changes are detected",
    "Clear costs. User control.",
]


def spoken(text):
    """Keep the brand pronunciation consistent while retaining its display name."""
    return text.replace("StudyFlow", "Study Flow").replace("US dollars", "U.S. dollars")


def paragraphs():
    return [{"id": f"chapter-{index:02d}", "title": title,
             "text": " ".join(line for _, line, _ in lines),
             "spoken_text": " ".join(spoken(line) for _, line, _ in lines),
             "shots": [{"number": number, "text": line, "spoken_text": spoken(line),
                        "tempo": tempo} for number, line, tempo in lines]}
            for index, (title, lines) in enumerate(CHAPTERS, 1)]
