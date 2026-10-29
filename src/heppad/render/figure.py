"""Render a PlotSpec by executing its generated script, segment by segment.

Executing the generated code (instead of a separate drawing implementation)
guarantees that the editor preview and the exported script draw the same plot.
"""

from __future__ import annotations

import io
import threading
from collections import namedtuple
from contextlib import contextmanager
from dataclasses import dataclass, field
from pathlib import Path

import matplotlib as mpl
import matplotlib.pyplot as plt
import mplhep as hep
import numpy as np
import uproot
from matplotlib.axes import Axes
from matplotlib.backends.backend_agg import FigureCanvasAgg
from matplotlib.colors import LogNorm, Normalize
from matplotlib.figure import Figure

from ..spec.models import PlotSpec
from .gids import Tagger, children, collect_elements

# rcParams and the plt.gca patch are process-global; renders must not interleave.
_LOCK = threading.RLock()


def style_params(name: str):
    return getattr(hep.style, name)


def effective_layout(spec: PlotSpec) -> dict:
    """Margins and spacing actually used, filling ``None`` from the style's rcParams."""
    lay = spec.layout
    with _LOCK, plt.style.context(style_params(spec.style)):
        rc = mpl.rcParams
        return {
            "margins": {
                "left": _pick(lay.margins.left, rc["figure.subplot.left"]),
                "right": _pick(lay.margins.right, 1 - rc["figure.subplot.right"]),
                "top": _pick(lay.margins.top, 1 - rc["figure.subplot.top"]),
                "bottom": _pick(lay.margins.bottom, rc["figure.subplot.bottom"]),
            },
            "hspace": _pick(lay.hspace, rc["figure.subplot.hspace"]),
            "wspace": _pick(lay.wspace, rc["figure.subplot.wspace"]),
        }


def _pick(value, default):
    return float(default if value is None else value)


@dataclass
class RenderResult:
    spec: PlotSpec
    fig: Figure
    pads: dict[str, Axes]
    tagger: Tagger
    warnings: list[str] = field(default_factory=list)
    # Per-layer systematic breakdown: {layer id: {"sources": [...], "missing": [...]}}.
    systematics: dict = field(default_factory=dict)

    def save(self, path, **kwargs) -> None:
        # The file is exactly the canvas the user set up: some styles (LHCb2) set
        # savefig.bbox = "tight", which would crop it. (bbox_inches=None would
        # fall back to that rc value, so override the rc value itself.)
        with (
            _LOCK,
            plt.style.context(style_params(self.spec.style)),
            mpl.rc_context({"savefig.bbox": "standard"}),
        ):
            self.fig.savefig(path, dpi=self.spec.canvas.dpi, **kwargs)

    def to_bytes(self, fmt: str) -> bytes:
        buf = io.BytesIO()
        self.save(buf, format=fmt)
        return buf.getvalue()

    def elements(self) -> dict:
        """Bounding boxes of selectable elements; requires a draw."""
        with _LOCK, plt.style.context(style_params(self.spec.style)):
            self.fig.canvas.draw()
            return collect_elements(self.fig, self.tagger, self.pads)


class _PyplotShim:
    """Stands in for ``plt`` inside executed segments.

    Figures are created without pyplot's global registry (no leaks in a
    long-running server), and ``sca`` records the axes that ``plt.gca()``
    should return (mplhep's label placement calls it).
    """

    def __init__(self) -> None:
        self.current: Axes | None = None

    def figure(self, figsize, dpi) -> Figure:
        fig = Figure(figsize=figsize, dpi=dpi)
        FigureCanvasAgg(fig)
        return fig

    def sca(self, ax: Axes) -> None:
        self.current = ax


@contextmanager
def _redirect_gca(shim: _PyplotShim):
    original = plt.gca
    plt.gca = lambda: shim.current if shim.current is not None else original()
    try:
        yield
    finally:
        plt.gca = original


def render(spec: PlotSpec, base_dir: str | Path = ".") -> RenderResult:
    from ..codegen.generate import generate
    from ..data.root import cached_object_paths, cached_read

    program = generate(spec, base_dir=base_dir)
    shim = _PyplotShim()
    ns = {
        "__name__": "heppad_render",
        "namedtuple": namedtuple, "Path": Path, "np": np, "uproot": uproot, "hep": hep,
        "LogNorm": LogNorm, "Normalize": Normalize, "plt": shim,
        "BASE": None, "INPUTS": program.inputs,
    }
    tagger = Tagger()
    warnings: list[str] = []
    with _LOCK, plt.style.context(style_params(spec.style)), _redirect_gca(shim):
        exec(program.helper_source(), ns)
        ns["read"] = cached_read
        ns["object_paths"] = lambda key: cached_object_paths(program.inputs.get(key, key))
        segments = iter(program.segments)
        exec(next(segments).code, ns)  # figure setup; failures here are fatal
        fig: Figure = ns["fig"]
        pads = {p.id: ns[_ax_var(p.id)] for p in spec.pads}

        for seg in segments:
            before = {ax: children(ax) for ax in fig.axes}
            try:
                exec(seg.code, ns)
            except Exception as exc:  # one broken layer must not kill the whole plot
                warnings.append(f"{seg.what}: {exc}")
                continue
            if seg.gid is None:
                continue
            if seg.members and seg.members in ns:
                for i, artists in enumerate(ns[seg.members]):
                    tagger.tag(artists, f"{seg.gid}.members.{i}")
            for ax in fig.axes:
                if ax in before:
                    tagger.tag(children(ax) - before[ax], seg.gid)
                else:
                    tagger.tag([ax], seg.gid)  # e.g. a colorbar's axes
        for pad_id, ax in pads.items():
            tagger.tag([ax.xaxis], f"pads.{pad_id}.xaxis")
            tagger.tag([ax.yaxis], f"pads.{pad_id}.yaxis")

    return RenderResult(spec=spec, fig=fig, pads=pads, tagger=tagger, warnings=warnings,
                        systematics=_breakdown(spec, ns))


def _breakdown(spec: PlotSpec, ns: dict) -> dict:
    """Summarize each layer's systematics relative to its nominal, largest first."""
    from ..codegen.runtime import group_sources

    out = {}
    for pad in spec.pads:
        for layer in pad.layers:
            h, syst = ns.get(_hist_var(layer.id)), ns.get(_hist_var(layer.id) + "_syst")
            if h is None or syst is None:
                continue
            nominal = np.asarray(h.values, dtype=float)
            total = nominal.sum()
            with np.errstate(divide="ignore", invalid="ignore"):
                def summary(down, up):
                    rel_down = np.where(nominal > 0, down / nominal, 0)
                    rel_up = np.where(nominal > 0, up / nominal, 0)
                    return {
                        # Yield-weighted average and largest single-bin relative error.
                        "down": float(down.sum() / total) if total else 0.0,
                        "up": float(up.sum() / total) if total else 0.0,
                        "down_max": float(np.max(rel_down, initial=0)),
                        "up_max": float(np.max(rel_up, initial=0)),
                    }
                sources = [{"source": name, **summary(d, u)} for name, (d, u) in syst.sources.items()]
                sources.sort(key=lambda x: -max(x["up"], x["down"]))
                stat = np.sqrt(np.asarray(h.variances, dtype=float))
                groups = []
                for name, members in group_sources(list(syst.sources), layer.syst_groups).items():
                    down = np.sqrt(sum((syst.sources[n][0] ** 2 for n in members), np.zeros_like(nominal)))
                    up = np.sqrt(sum((syst.sources[n][1] ** 2 for n in members), np.zeros_like(nominal)))
                    groups.append({"group": name, "sources": members, **summary(down, up)})
                out[layer.id] = {
                    "sources": sources,
                    "groups": groups if layer.syst_groups else [],
                    "stat": summary(stat, stat),
                    "total": summary(syst.down, syst.up),
                    "combined": summary(np.hypot(stat, syst.down), np.hypot(stat, syst.up)),
                    "missing": [list(x) for x in syst.missing],
                }
    return out


def _hist_var(layer_id: str) -> str:
    from ..codegen.generate import ident

    return ident(f"h_{layer_id}")


def _ax_var(pad_id: str) -> str:
    from ..codegen.generate import ident

    return ident(f"ax_{pad_id}")
