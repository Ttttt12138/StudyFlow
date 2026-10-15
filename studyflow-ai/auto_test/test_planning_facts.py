from studyflow_ai.agent.planning_facts import ambiguities, amounts


def test_only_the_labelled_loan_amount_is_read():
    value = amounts("我选普吉，存款20万人民币，月收入3万泰铢，想借30万泰铢，家人支持50000泰铢于2027-08-02到账")
    assert value == {"principal": "300000.00", "principal_currency": "THB"}
    # Savings, income and family support are no longer planning inputs.
    assert amounts("saved 25,000 USD, family support 5000 USD, monthly income 30000 THB") == {}


def test_tuition_dates_terms_and_rates_are_not_the_loan_amount():
    assert amounts("Tuition 65000, borrow 20000 THB for 48 months from 2027-09-01") == {
        "principal": "20000.00", "principal_currency": "THB"}
    for text in ("贷款36个月", "帮我贷款，分36个月", "loan 48 months", "贷款利率6%", "borrow over 3.5 years"):
        assert amounts(text) == {}, text
    assert amounts("loan amount is 1,200,000 THB") == {"principal": "1200000.00", "principal_currency": "THB"}
    assert amounts("贷款20万，分3年") == {"principal": "200000.00"}


def test_ambiguous_amount_is_not_silently_selected_and_punctuation_is_safe():
    text = "borrow 5000 USD or borrow 30000 THB"
    assert ambiguities(text) == ["principal"]
    assert "principal" not in amounts(text)
    assert amounts("savings, family support, borrowing not known yet") == {}
