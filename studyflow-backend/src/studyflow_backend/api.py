"""HTTP composition; domain services know neither FastAPI nor authentication tokens."""

from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo

from fastapi import Depends, FastAPI, Header, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException

from studyflow_backend import applications, lending
from studyflow_backend import responses as out
from studyflow_backend.database import make_engine, sessions, token_digest
from studyflow_backend.errors import DomainError
from studyflow_backend.models import Actor, Application, Ledger, Loan, Profile, Quote, Wallet
from studyflow_backend.repository import assessment, owned
from studyflow_backend.schemas import (
    ApplicationInput,
    ProfileInput,
    QuoteInput,
    RepayInput,
    ReviewInput,
    TopupInput,
    VersionInput,
)
from studyflow_backend.transactions import Command, execute
from studyflow_backend.views import (
    application_view,
    ledger_view,
    loan_view,
    profile_view,
    wallet_view,
)

PREFIX = "/api/v1"
BANGKOK = ZoneInfo("Asia/Bangkok")
bearer = HTTPBearer(auto_error=False)


def system_clock():
    return datetime.now(BANGKOK)


def create_app(engine=None, clock=None):
    app = FastAPI(
        title="StudyFlow B — Simulated Lending",
        version="0.1.0",
        responses={status: {"model": out.ErrorResult} for status in (401, 403, 404, 409, 422, 503)},
    )
    app.state.engine = engine if engine is not None else make_engine()
    app.state.sessions = sessions(app.state.engine)
    app.state.clock = clock or system_clock
    install_errors(app)
    install_routes(app)
    return app


def now(request):
    value = request.app.state.clock()
    if value.tzinfo is None or value.utcoffset() is None:
        raise RuntimeError("Clock must return a timezone-aware datetime")
    return value.astimezone(BANGKOK)


def actor(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None:
        raise DomainError("UNAUTHENTICATED", 401)
    with request.app.state.sessions() as session:
        row = session.scalar(
            select(Actor).where(
                Actor.token_hash == token_digest(credentials.credentials),
            )
        )
        if row is None:
            raise DomainError("UNAUTHENTICATED", 401)
        return row


def student(current=Depends(actor)):
    if current.role != "student":
        raise DomainError("FORBIDDEN", 403)
    return current


def admin(current=Depends(actor)):
    if current.role != "admin":
        raise DomainError("FORBIDDEN", 403)
    return current


def idempotency_key(value: str = Header(alias="Idempotency-Key", min_length=1, max_length=128)):
    if not value.strip():
        raise DomainError("INVALID_IDEMPOTENCY_KEY", 422)
    return value


def mutate(request, current, key, body, action, object_id=None):
    command = Command(
        current.id,
        request.url.path,
        key,
        body.model_dump(mode="json"),
        now(request),
        request.state.trace_id,
    )

    def work(session):
        if object_id is None:
            return action(session, command, body)
        return action(session, command, object_id, body)

    return execute(request.app.state.sessions, command, work)


def error_response(request, code, status):
    headers = {"WWW-Authenticate": "Bearer"} if status == 401 else {}
    headers["X-Trace-ID"] = request.state.trace_id
    return JSONResponse(
        status_code=status,
        headers=headers,
        content={
            "error": {"code": code},
            "trace_id": request.state.trace_id,
            "simulated": True,
        },
    )


def install_errors(app):
    @app.middleware("http")
    async def trace(request, call_next):
        request.state.trace_id = str(uuid4())
        response = await call_next(request)
        response.headers["X-Trace-ID"] = request.state.trace_id
        return response

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return error_response(request, exc.code, exc.status)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        return error_response(request, "INVALID_INPUT", 422)

    @app.exception_handler(IntegrityError)
    async def constraint_error(request, exc):
        return error_response(request, "CONSTRAINT_CONFLICT", 409)

    @app.exception_handler(OperationalError)
    async def database_error(request, exc):
        return error_response(request, "DATABASE_UNAVAILABLE", 503)

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error_response(request, f"HTTP_{exc.status_code}", exc.status_code)

    @app.exception_handler(Exception)
    async def unexpected_error(request, exc):
        return error_response(request, "INTERNAL_ERROR", 500)


def page(session, query, render, limit, offset):
    rows = session.scalars(query.offset(offset).limit(limit + 1)).all()
    return {
        "items": [render(row) for row in rows[:limit]],
        "limit": limit,
        "offset": offset,
        "has_more": len(rows) > limit,
        "simulated": True,
    }


def read_session(request: Request):
    with request.app.state.sessions.begin() as session:
        session.connection(execution_options={"isolation_level": "REPEATABLE READ"})
        yield session


def install_routes(app):
    install_quote_routes(app)
    install_application_routes(app)
    install_admin_routes(app)
    install_loan_routes(app)

    @app.get("/health")
    def health(session=Depends(read_session)):
        session.execute(select(1))
        return {"status": "ok", "simulated": True}


def install_quote_routes(app):
    @app.post(
        PREFIX + "/loan-quotes", status_code=201, tags=["quotes"], response_model=out.QuoteResult
    )
    def quote(
        body: QuoteInput, request: Request, current=Depends(student), key=Depends(idempotency_key)
    ):
        return mutate(request, current, key, body, applications.create_quote)

    @app.get(PREFIX + "/loan-quotes/{quote_id}", tags=["quotes"], response_model=out.QuoteResult)
    def get_quote(quote_id: str, current=Depends(student), session=Depends(read_session)):
        row = owned(session, Quote, quote_id, current.id)
        application_id = session.scalar(
            select(Application.id).where(Application.quote_id == row.id)
        )
        return {
            "quote_id": row.id,
            **row.data,
            "assessment": assessment(session, row, application_id or ""),
        }

    @app.get(PREFIX + "/loan-quotes", tags=["quotes"], response_model=out.Page[out.QuoteResult])
    def quotes(
        current=Depends(student),
        session=Depends(read_session),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        query = (
            select(Quote).where(Quote.student_id == current.id).order_by(Quote.created_at, Quote.id)
        )
        return page(session, query, lambda r: {"quote_id": r.id, **r.data}, limit, offset)

    @app.put(
        PREFIX + "/affordability-profiles", tags=["profiles"], response_model=out.ProfileResult
    )
    def profile(
        body: ProfileInput, request: Request, current=Depends(student), key=Depends(idempotency_key)
    ):
        return mutate(request, current, key, body, applications.save_profile)

    @app.get(
        PREFIX + "/affordability-profiles", tags=["profiles"], response_model=out.ProfileResult
    )
    def get_profile(current=Depends(student), session=Depends(read_session)):
        return profile_view(session.get(Profile, current.id))


def install_application_routes(app):
    @app.post(
        PREFIX + "/loan-applications",
        status_code=201,
        tags=["applications"],
        response_model=out.ApplicationResult,
    )
    def create(
        body: ApplicationInput,
        request: Request,
        current=Depends(student),
        key=Depends(idempotency_key),
    ):
        return mutate(request, current, key, body, applications.create_application)

    @app.get(
        PREFIX + "/loan-applications/{application_id}",
        tags=["applications"],
        response_model=out.ApplicationResult,
    )
    def get(application_id: str, current=Depends(student), session=Depends(read_session)):
        return application_view(owned(session, Application, application_id, current.id))

    @app.get(
        PREFIX + "/loan-applications",
        tags=["applications"],
        response_model=out.Page[out.ApplicationResult],
    )
    def listing(
        current=Depends(student),
        session=Depends(read_session),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        query = select(Application).where(Application.student_id == current.id)
        return page(
            session,
            query.order_by(Application.created_at, Application.id),
            application_view,
            limit,
            offset,
        )

    @app.post(
        PREFIX + "/loan-applications/{application_id}/submit",
        tags=["applications"],
        response_model=out.ApplicationResult,
    )
    def submit(
        application_id: str,
        body: VersionInput,
        request: Request,
        current=Depends(student),
        key=Depends(idempotency_key),
    ):
        return mutate(request, current, key, body, applications.submit, application_id)

    @app.post(
        PREFIX + "/loan-applications/{application_id}/cancel",
        tags=["applications"],
        response_model=out.ApplicationResult,
    )
    def cancel(
        application_id: str,
        body: VersionInput,
        request: Request,
        current=Depends(student),
        key=Depends(idempotency_key),
    ):
        return mutate(request, current, key, body, applications.cancel, application_id)


def install_admin_routes(app):
    @app.get(
        PREFIX + "/admin/loan-applications",
        tags=["admin"],
        response_model=out.Page[out.AdminApplicationResult],
    )
    def listing(
        current=Depends(admin),
        session=Depends(read_session),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        query = select(Application).order_by(Application.created_at, Application.id)
        return page(
            session,
            query,
            lambda r: {"student_id": r.student_id, **application_view(r)},
            limit,
            offset,
        )

    @app.get(
        PREFIX + "/admin/loan-applications/{application_id}",
        tags=["admin"],
        response_model=out.AdminApplicationResult,
    )
    def get(application_id: str, current=Depends(admin), session=Depends(read_session)):
        row = owned(session, Application, application_id)
        return {"student_id": row.student_id, **application_view(row)}

    @app.post(
        PREFIX + "/admin/loan-applications/{application_id}/review",
        tags=["admin"],
        response_model=out.ApplicationResult,
    )
    def review(
        application_id: str,
        body: ReviewInput,
        request: Request,
        current=Depends(admin),
        key=Depends(idempotency_key),
    ):
        return mutate(request, current, key, body, applications.review, application_id)

    @app.post(
        PREFIX + "/admin/loan-applications/{application_id}/disburse",
        tags=["admin"],
        response_model=out.DisbursementResult,
    )
    def disburse(
        application_id: str,
        body: VersionInput,
        request: Request,
        current=Depends(admin),
        key=Depends(idempotency_key),
    ):
        return mutate(request, current, key, body, lending.disburse, application_id)

    @app.post(PREFIX + "/admin/wallet-topups", tags=["admin"], response_model=out.WalletResult)
    def topup(
        body: TopupInput, request: Request, current=Depends(admin), key=Depends(idempotency_key)
    ):
        return mutate(request, current, key, body, lending.topup)

    @app.get(
        PREFIX + "/admin/wallets/{student_id}", tags=["admin"], response_model=out.WalletResult
    )
    def wallet(student_id: str, current=Depends(admin), session=Depends(read_session)):
        row = session.get(Wallet, student_id)
        if row is None:
            raise DomainError("NOT_FOUND", 404)
        return wallet_view(row)


def install_loan_routes(app):
    @app.get(PREFIX + "/loans/{loan_id}", tags=["loans"], response_model=out.LoanResult)
    def get(
        loan_id: str, request: Request, current=Depends(student), session=Depends(read_session)
    ):
        return loan_view(session, owned(session, Loan, loan_id, current.id), now(request).date())

    @app.get(PREFIX + "/loans", tags=["loans"], response_model=out.Page[out.LoanResult])
    def listing(
        request: Request,
        current=Depends(student),
        session=Depends(read_session),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        query = (
            select(Loan).where(Loan.student_id == current.id).order_by(Loan.disbursed_at, Loan.id)
        )
        return page(
            session, query, lambda r: loan_view(session, r, now(request).date()), limit, offset
        )

    @app.post(PREFIX + "/loans/{loan_id}/repay", tags=["loans"], response_model=out.RepaymentResult)
    def repay(
        loan_id: str,
        body: RepayInput,
        request: Request,
        current=Depends(student),
        key=Depends(idempotency_key),
    ):
        return mutate(request, current, key, body, lending.repay, loan_id)

    @app.get(PREFIX + "/wallet", tags=["wallet"], response_model=out.WalletResult)
    def wallet(current=Depends(student), session=Depends(read_session)):
        return wallet_view(session.get(Wallet, current.id))

    @app.get(PREFIX + "/wallet/ledger", tags=["wallet"], response_model=out.Page[out.LedgerResult])
    def ledger(
        current=Depends(student),
        session=Depends(read_session),
        limit: int = Query(20, ge=1, le=100),
        offset: int = Query(0, ge=0),
    ):
        query = (
            select(Ledger)
            .where(Ledger.student_id == current.id)
            .order_by(
                Ledger.sequence,
            )
        )
        return page(session, query, ledger_view, limit, offset)
