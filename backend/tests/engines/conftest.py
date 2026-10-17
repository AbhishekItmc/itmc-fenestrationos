import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parents[2]
if str(BACKEND) not in sys.path:
    sys.path.insert(0, str(BACKEND))

from app.engines.catalogue import load_demo_catalogue  # noqa: E402


@pytest.fixture
def cat():
    return load_demo_catalogue()
