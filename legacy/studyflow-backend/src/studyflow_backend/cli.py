import argparse
import json
import os
from pathlib import Path

from alembic import command
from alembic.config import Config

from studyflow_backend.database import make_engine, seed_actor, sessions


def migrate(engine):
    config_path = Path.cwd() / "alembic.ini"
    if not config_path.exists():
        raise ValueError("Run from the backend project directory containing alembic.ini")
    with engine.begin() as connection:
        config = Config(str(config_path))
        config.attributes["connection"] = connection
        command.upgrade(config, "head")


def initialize(args):
    engine = make_engine()
    try:
        with sessions(engine).begin() as session:
            return {
                "simulated": True,
                "student_id": args.student_id,
                "student_token": seed_actor(session, args.student_id, "student"),
                "admin_id": args.admin_id,
                "admin_token": seed_actor(session, args.admin_id, "admin"),
            }
    finally:
        engine.dispose()


def demonstrate(args):
    from studyflow_backend.demo import run_demo

    value = os.environ.get("DEMO_DATABASE_URL")
    if not value:
        raise ValueError("Set DEMO_DATABASE_URL; the main database is never used for demos")
    engine = make_engine(value)
    try:
        if not engine.url.database.endswith("_demo"):
            raise ValueError("Demo database name must end in _demo")
        migrate(engine)
        return run_demo(engine, args.with_c)
    finally:
        engine.dispose()


def main():
    parser = argparse.ArgumentParser(description="StudyFlow B simulation tools")
    commands = parser.add_subparsers(dest="command", required=True)
    seed = commands.add_parser("init-identities", help="Create identities; print tokens once")
    seed.add_argument("--student-id", default="student_001")
    seed.add_argument("--admin-id", default="admin_001")
    demo = commands.add_parser("demo", help="Run isolated PostgreSQL HTTP demonstration")
    demo.add_argument("--with-c", action="store_true")
    demo.add_argument("--output", type=Path, default=Path("output/demo.json"))
    args = parser.parse_args()
    result = initialize(args) if args.command == "init-identities" else demonstrate(args)
    if args.command == "demo":
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
        print(
            json.dumps(
                {
                    "output": str(args.output),
                    "status": result["settled"]["loan"]["status"],
                    "simulated": True,
                }
            )
        )
    else:
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
