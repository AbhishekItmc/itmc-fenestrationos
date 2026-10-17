"""`python -m app.seed` — idempotent seed against DATABASE_URL (run `alembic upgrade head` first)."""
from __future__ import annotations

import json

from ..config import get_settings
from ..db import make_engine, make_sessionmaker
from ..logging_conf import configure_logging
from . import run_seed


def main() -> None:
    s = get_settings()
    configure_logging(s.log_level, s.log_json)
    for w in s.startup_warnings():
        print("WARNING:", w)
    engine = make_engine(s.database_url)
    with make_sessionmaker(engine)() as db:
        print(json.dumps(run_seed(db, s)))


if __name__ == "__main__":
    main()
