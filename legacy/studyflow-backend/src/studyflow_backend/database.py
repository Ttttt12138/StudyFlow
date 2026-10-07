import hashlib
import os
import secrets

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from studyflow_backend.models import Actor, Wallet


def database_url():
    value = os.environ.get("DATABASE_URL")
    if not value:
        raise RuntimeError("Set DATABASE_URL to a PostgreSQL psycopg URL")
    return value


def make_engine(url=None):
    engine = create_engine(url or database_url(), pool_pre_ping=True)
    if engine.dialect.name != "postgresql":
        raise ValueError("PostgreSQL is required; SQLite is not a transaction substitute")
    return engine


def sessions(engine):
    return sessionmaker(engine, expire_on_commit=False)


def token_digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def seed_actor(session, actor_id, role):
    if session.get(Actor, actor_id):
        raise ValueError(f"Actor {actor_id} already exists; token is not reset")
    token = secrets.token_urlsafe(32)
    session.add(Actor(id=actor_id, role=role, token_hash=token_digest(token)))
    session.flush()
    if role == "student":
        session.add(Wallet(student_id=actor_id))
    return token
