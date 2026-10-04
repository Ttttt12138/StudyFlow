import calendar
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, localcontext

def loan_schedule(data):
    currency = data["currency"]
    unit = Decimal("1") if currency == "JPY" else Decimal("0.01")
    def money(value):
        return Decimal(value).quantize(unit, rounding=ROUND_HALF_UP)
    def display(value):
        return format(money(value), ".0f" if currency == "JPY" else ".2f")
    principal = Decimal(data["principal"])
    fee = Decimal(data["withheld_fee"])
    if principal <= 0 or fee >= principal:
        raise ValueError("Principal must be positive and withheld fee less than principal.")
    if any(Decimal(v) != money(v) for v in [principal,fee]):
        raise ValueError("Amount precision is invalid for this currency.")
    start = data["disbursement_date"]
    if isinstance(start,str): start = date.fromisoformat(start)
    months, grace = data["repayment_months"], data["grace_months"]
    if start.year + (months+grace)//12 + 1 > 9999:
        raise ValueError("Repayment dates exceed the supported calendar.")
    def due(index):
        absolute = start.year*12 + start.month-1 + index
        year, month = divmod(absolute,12)
        month += 1
        return date(year,month,min(start.day,calendar.monthrange(year,month)[1])).isoformat()
    with localcontext() as context:
        context.prec = 48
        rate = Decimal(data["annual_rate_percent"])/Decimal("1200")
        balance, interest_total = principal, Decimal(0)
        schedule = []
        for i in range(1,grace+1):
            interest = money(balance*rate)
            opening = balance
            balance += interest
            interest_total += interest
            schedule.append({"number":i,"due_date":due(i),"opening_balance":display(opening),
                "payment":display(0),"interest":display(interest),"principal":display(0),
                "closing_balance":display(balance),"phase":"capitalizing_grace"})
        payment = money(balance/months if rate == 0 else balance*rate/(1-(1+rate)**(-months)))
        for j in range(1,months+1):
            opening = balance
            interest = money(opening*rate)
            installment = money(opening+interest) if j == months else min(payment,opening+interest)
            principal_due = installment-interest
            if principal_due < 0:
                raise ValueError("Rounding produces negative amortization; use a shorter term or larger principal.")
            balance = money(opening-principal_due)
            interest_total += interest
            schedule.append({"number":grace+j,"due_date":due(grace+j),"opening_balance":display(opening),
                "payment":display(installment),"interest":display(interest),"principal":display(principal_due),
                "closing_balance":display(balance),"phase":"repayment"})
        if any(Decimal(row["payment"]) > Decimal("99999999999999.99") for row in schedule):
            raise ValueError("Repayment exceeds supported monetary precision.")
        total = sum(Decimal(row["payment"]) for row in schedule)
        maximum = max(Decimal(row["payment"]) for row in schedule)
        income, expenses = data.get("monthly_income"), data.get("monthly_essential_expenses")
        affordability = "insufficient_information"
        if data.get("income_confirmed") and income is not None and expenses is not None:
            affordability = "affordable_under_assumptions" if Decimal(income)-Decimal(expenses) >= maximum else "unaffordable"
        return {"is_simulated":True,"currency":currency,"net_proceeds":display(principal-fee),
            "principal":display(principal),"withheld_fee":display(fee),
            "total_interest":display(interest_total),"total_repayment":display(total),
            "total_cost_over_net_proceeds":display(total-(principal-fee)),
            "maximum_installment":display(maximum),"affordability_status":affordability,
            "schedule":schedule,"conventions":{
                "rate":"nominal annual percentage divided by 12",
                "grace":"monthly interest capitalized; zero payments",
                "rounding":"half up at currency precision, final installment clears balance",
                "income":"constant monthly income/expenses in loan currency; no FX assumptions",
            }}
