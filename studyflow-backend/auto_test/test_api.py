import pytest

pytestmark = pytest.mark.postgres


def test_auth_role_ownership_and_validation(api):
    assert api.client.get("/api/v1/wallet").status_code == 401
    invalid = api.client.get("/api/v1/wallet", headers={"Authorization": "Bearer invalid"})
    assert invalid.status_code == 401
    assert invalid.headers["x-trace-id"] == invalid.json()["trace_id"]
    assert api.request("GET", "/wallet", role="admin").status_code == 403
    quote = api.quote()
    assert api.request("GET", f"/loan-quotes/{quote['quote_id']}", role="other").status_code == 404
    assert (
        api.request(
            "POST", "/loan-applications", {"quote_id": quote["quote_id"]}, role="other"
        ).status_code
        == 404
    )
    assert api.request("GET", "/admin/loan-applications").status_code == 403
    assert (
        api.request(
            "PUT",
            "/affordability-profiles",
            {"expected_version": 0, "months": [], "student_id": "other"},
        ).status_code
        == 422
    )
    response = api.client.post(
        "/api/v1/loan-applications",
        json={"quote_id": quote["quote_id"]},
        headers={"Authorization": "Bearer " + api.tokens["student"]},
    )
    assert response.status_code == 422


def test_idempotency_payload_conflict_and_cross_operation(api):
    body = {
        "principal": "30600",
        "fees": "600",
        "annual_rate": "0",
        "months": 12,
        "first_due_date": "2026-11-01",
    }
    first = api.ok("POST", "/loan-quotes", body, key="same")
    assert api.ok("POST", "/loan-quotes", body, key="same") == first
    changed = {**body, "fees": "500"}
    assert api.request("POST", "/loan-quotes", changed, key="same").status_code == 409
    assert (
        api.request(
            "POST", "/loan-applications", {"quote_id": first["quote_id"]}, key="same"
        ).status_code
        == 409
    )


def test_pagination_profiles_and_quote_immutable(api):
    quote = api.quote()
    api.quote()
    listing = api.ok("GET", "/loan-quotes?limit=1")
    assert len(listing["items"]) == 1 and listing["has_more"]
    assert api.ok("GET", "/loan-quotes?limit=1&offset=1")["has_more"] is False
    assert api.request("PATCH", f"/loan-quotes/{quote['quote_id']}", {}).status_code == 405
    profile = api.profile(quote)
    assert profile["version"] == 1
    assert (
        api.request(
            "PUT", "/affordability-profiles", {"expected_version": 0, "months": []}
        ).status_code
        == 409
    )


def test_openapi_health_and_cross_student_loans(api):
    assert api.client.get("/health").json()["status"] == "ok"
    schema = api.client.get("/openapi.json").json()
    assert "/api/v1/loan-quotes" in schema["paths"]
    assert "request" not in [
        p["name"] for p in schema["paths"]["/api/v1/wallet"]["get"].get("parameters", [])
    ]
    result = api.disburse()
    loan_id, application_id = result["loan"]["loan_id"], result["application"]["application_id"]
    for path in (f"/loans/{loan_id}", f"/loan-applications/{application_id}"):
        assert api.request("GET", path, role="other").status_code == 404
    assert api.ok("GET", "/loans", role="other")["items"] == []
    assert api.ok("GET", "/wallet/ledger", role="other")["items"] == []
