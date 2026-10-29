"""Browse ROOT files and read objects (cached) with uproot."""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import uproot

from ..codegen.runtime import read


@dataclass(frozen=True)
class ObjectInfo:
    path: str
    classname: str

    @property
    def kind(self) -> str:
        cls = self.classname
        if cls.startswith("TH2"):
            return "h2"
        if cls.startswith(("TH1", "TProfile")):
            return "h1"
        if cls.startswith("TGraph"):
            return "graph"
        if cls.startswith("TDirectory"):
            return "dir"
        return "other"


def list_objects(file: str | Path) -> list[ObjectInfo]:
    """All objects in the file (latest cycle only), recursively."""
    with uproot.open(file) as f:
        return [
            ObjectInfo(path=key, classname=cls)
            for key, cls in f.classnames(cycle=False, recursive=True).items()
        ]


def cached_read(file: str | Path, path: str) -> dict:
    """``runtime.read`` with a cache keyed on the file's modification time.

    Returned arrays are shared between callers and marked read-only.
    """
    file = os.path.abspath(file)
    return _read(file, os.path.getmtime(file), path)


@lru_cache(maxsize=512)
def _read(file: str, mtime: float, path: str) -> dict:
    obj = read(file, path)
    for value in obj.values():
        for arr in value if isinstance(value, list) else [value]:
            if isinstance(arr, np.ndarray):
                arr.flags.writeable = False
    return obj


def cached_object_paths(file: str | Path) -> list[str]:
    """Object paths in a file (for systematic source discovery), cached on mtime."""
    file = os.path.abspath(file)
    return list(_object_paths(file, os.path.getmtime(file)))


@lru_cache(maxsize=64)
def _object_paths(file: str, mtime: float) -> tuple[str, ...]:
    with uproot.open(file) as f:
        return tuple(f.classnames(cycle=False, recursive=True))
