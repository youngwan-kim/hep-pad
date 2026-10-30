"""Browse ROOT files and read objects (cached) with uproot."""

from __future__ import annotations

import math
import os
import time
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import uproot

from ..codegen.runtime import read, tree_columns

# Remote files have no cheap modification time, so cached reads of them are
# reused for this many seconds instead.
REMOTE_TTL = 60.0


def is_url(path: str | Path) -> bool:
    """Whether ``path`` is a URL (``root://``, ``ssh://``, ``https://``, ...) for uproot/fsspec."""
    return "://" in str(path)


def _cache_key(file: str | Path) -> tuple[str, float]:
    if is_url(file):
        return str(file), time.monotonic() // REMOTE_TTL
    file = os.path.abspath(file)
    return file, os.path.getmtime(file)


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
        if cls.startswith("TTree"):
            return "tree"
        return "other"


def list_objects(file: str | Path) -> list[ObjectInfo]:
    """All objects in the file (latest cycle only), recursively."""
    with uproot.open(file) as f:
        return [
            ObjectInfo(path=key, classname=cls)
            for key, cls in f.classnames(cycle=False, recursive=True).items()
        ]


def cached_read(file: str | Path, path: str, tree: dict | None = None) -> dict:
    """``runtime.read`` with a cache keyed on the file's modification time
    (or, for URLs, refreshed every ``REMOTE_TTL`` seconds).

    Returned arrays are shared between callers and marked read-only.
    """
    frozen = None if tree is None else tuple(
        (k, tuple(v) if isinstance(v, list) else v) for k, v in sorted(tree.items()))
    return _read(*_cache_key(file), path, frozen)


@lru_cache(maxsize=512)
def _read(file: str, mtime: float, path: str, tree: tuple | None = None) -> dict:
    if tree is not None:
        tree = {k: list(v) if isinstance(v, tuple) else v for k, v in tree}
    obj = read(file, path, tree)
    for value in obj.values():
        for arr in value if isinstance(value, list) else [value]:
            if isinstance(arr, np.ndarray):
                arr.flags.writeable = False
    return obj


def cached_object_paths(file: str | Path) -> list[str]:
    """Object paths in a file (for systematic source discovery), cached like ``cached_read``."""
    return list(_object_paths(*_cache_key(file)))


@lru_cache(maxsize=64)
def _object_paths(file: str, mtime: float) -> tuple[str, ...]:
    with uproot.open(file) as f:
        return tuple(f.classnames(cycle=False, recursive=True))


def tree_branches(file: str | Path, path: str) -> list[dict]:
    """Branches of a TTree that hold data (record parents are skipped)."""
    with uproot.open(file) as f:
        t = f[path]
        return [{"name": k, "type": t[k].typename, "jagged": t[k].typename.endswith("[]")}
                for k in t.keys(recursive=True) if t[k].typename]


def tree_preview(file: str | Path, path: str, expr: str, cut: str | None = None,
                 entry_stop: int = 100_000) -> dict:
    """Range and a quick histogram of ``expr`` over the first entries, with suggested bins."""
    import awkward as ak

    chunks = []
    with uproot.open(file) as f:
        t = f[path]
        entries = t.num_entries
        for x, keep in tree_columns(t, [expr, cut or "True"], entry_stop):
            x, keep = ak.broadcast_arrays(x, keep)
            keep = ak.fill_none(keep, False) & ~ak.is_none(x, axis=-1)
            chunks.append(ak.to_numpy(ak.flatten(x[keep], axis=None)).astype(np.float64))
    x = np.concatenate(chunks) if chunks else np.empty(0)
    x = x[np.isfinite(x)]
    out = {"entries": entries, "sampled": min(entries, entry_stop), "count": int(x.size)}
    if not x.size:
        return out
    lo, hi = float(x.min()), float(x.max())
    if np.all(x == np.round(x)) and hi - lo <= 100:
        bins = [int(hi - lo) + 1, lo - 0.5, hi + 0.5]  # integers (counts, flags): one bin each
    else:
        step = 10 ** math.floor(math.log10(hi - lo)) if hi > lo else 1.0
        bins = [50, math.floor(lo / step) * step, math.ceil(hi / step) * step]
        if bins[1] == bins[2]:
            bins[2] = bins[1] + step
    values = np.histogram(x, np.linspace(bins[1], bins[2], bins[0] + 1))[0]
    return {**out, "min": lo, "max": hi, "bins": bins, "values": values.tolist()}
