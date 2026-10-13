from studyflow_ai.agent.planning_facts import ambiguities, amounts


def test_labelled_amounts_keep_their_own_currency():
    value = amounts("我选普吉，存款20万人民币，月收入3万泰铢，每月支出1万泰铢，已有还款0泰铢，家人支持50000泰铢于2027-08-02到账")
    assert value["available_funds"] == "200000.00"
    assert value["funds_currency"] == "CNY"
    assert value["monthly_income"] == "30000.00"
    assert value["monthly_income_currency"] == "THB"
    assert value["support_date"] == "2027-08-02"
    assert value["support_currency"] == "THB"


def test_tuition_dates_and_terms_are_not_savings():
    assert "available_funds" not in amounts("Tuition 65000, borrow 20000 THB for 48 months from 2027-09-01")
    assert amounts("saved 25,000 USD and monthly income 30000 THB")["available_funds"] == "25000.00"


def test_ambiguous_amount_is_not_silently_selected_and_punctuation_is_safe():
    text = "savings 5000 USD or savings 30000 THB, monthly income 40000 THB"
    assert ambiguities(text) == ["available_funds"]
    assert "available_funds" not in amounts(text)
    assert amounts(text)["monthly_income"] == "40000.00"
    assert amounts("savings, family support, not known yet") == {}
