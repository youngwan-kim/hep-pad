import shutil
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "fixtures"))

from make_fixture_root import make  # noqa: E402

EXAMPLES = sorted((ROOT / "examples").glob("*.yaml"))


@pytest.fixture(scope="session")
def workdir(tmp_path_factory) -> Path:
    """A directory holding sample.root and copies of the example specs."""
    d = tmp_path_factory.mktemp("work")
    make(d / "sample.root")
    for spec in EXAMPLES:
        shutil.copy(spec, d)
    return d
