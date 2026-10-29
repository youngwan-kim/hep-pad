"""Load and save plot specs as YAML (or JSON, which is valid YAML)."""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any

from ruamel.yaml import YAML

from .models import SPEC_VERSION, PlotSpec

# Migration functions keyed by the version they upgrade *from*.
_MIGRATIONS: dict[int, Any] = {}


def _yaml() -> YAML:
    y = YAML(typ="safe", pure=True)
    y.default_flow_style = None  # short lists/dicts inline, nested blocks expanded
    y.width = 120
    y.sort_base_mapping_type_on_output = False
    return y


def migrate(data: dict) -> dict:
    version = data.get("version", SPEC_VERSION)
    if version > SPEC_VERSION:
        raise ValueError(
            f"spec version {version} is newer than supported version {SPEC_VERSION}"
        )
    while version < SPEC_VERSION:
        data = _MIGRATIONS[version](data)
        version = data["version"]
    return data


def from_dict(data: dict) -> PlotSpec:
    return PlotSpec.model_validate(migrate(dict(data)))


def to_dict(spec: PlotSpec) -> dict:
    """Minimal dict: fields left at their defaults are omitted."""
    data = spec.model_dump(mode="json", exclude_defaults=True)
    # Keep the version explicit so future migrations know where to start.
    return {"version": spec.version, **{k: v for k, v in data.items() if k != "version"}}


def loads(text: str) -> PlotSpec:
    return from_dict(_yaml().load(text) or {})


def dumps(spec: PlotSpec) -> str:
    buf = io.StringIO()
    _yaml().dump(to_dict(spec), buf)
    return buf.getvalue()


def load(path: str | Path) -> PlotSpec:
    return loads(Path(path).read_text())


def save(spec: PlotSpec, path: str | Path) -> None:
    Path(path).write_text(dumps(spec))
