"""Tag artists with spec paths so the rendered SVG can be mapped back to the spec.

Each artist gets an SVG id of the form ``<spec path>`` or ``<spec path>@<n>``
(ids must be unique in SVG). The frontend strips the ``@n`` suffix to find the
spec node a clicked element belongs to.
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Iterable

from matplotlib.artist import Artist
from matplotlib.axes import Axes
from matplotlib.container import Container
from matplotlib.figure import Figure
from matplotlib.transforms import Bbox

SUFFIX_SEP = "@"


class Tagger:
    def __init__(self) -> None:
        self._counts: dict[str, int] = defaultdict(int)
        self.tagged: dict[str, list[Artist]] = defaultdict(list)

    def tag(self, artists: Iterable, gid: str) -> None:
        for artist in flatten(artists):
            if artist.get_gid():
                continue  # already tagged by a more specific caller
            n = self._counts[gid]
            artist.set_gid(gid if n == 0 else f"{gid}{SUFFIX_SEP}{n}")
            self._counts[gid] += 1
            self.tagged[gid].append(artist)


def flatten(obj) -> Iterable[Artist]:
    """Yield Artists from nested containers/tuples/lists/namedtuples."""
    if obj is None:
        return
    if isinstance(obj, Artist):
        yield obj
    elif isinstance(obj, (Container, tuple, list, set)):
        for item in obj:
            yield from flatten(item)
    elif hasattr(obj, "_asdict"):
        for item in obj._asdict().values():
            yield from flatten(item)


def children(ax: Axes) -> set[Artist]:
    return set(ax.get_children())


def collect_elements(fig: Figure, tagger: Tagger, pads: dict[str, Axes]) -> dict:
    """Element bounding boxes and pad geometry, in figure fraction (origin top-left)."""
    renderer = fig.canvas.get_renderer()
    fw, fh = fig.bbox.width, fig.bbox.height

    def frac(bb: Bbox) -> list[float]:
        return [
            round(float(bb.x0) / fw, 5),
            round(1 - float(bb.y1) / fh, 5),
            round(float(bb.x1) / fw, 5),
            round(1 - float(bb.y0) / fh, 5),
        ]

    elements = {}
    for gid, artists in tagger.tagged.items():
        boxes = []
        for a in artists:
            if not a.get_visible():
                continue
            try:
                # get_tightbbox covers composite artists (Axis: ticks + label).
                bb = a.get_tightbbox(renderer) or a.get_window_extent(renderer)
            except Exception:
                continue
            if bb.width > 0 or bb.height > 0:
                boxes.append(bb)
        if boxes:
            elements[gid] = {"bbox": frac(Bbox.union(boxes))}

    def anchor(ax: Axes, label) -> list[float]:
        """Where an axis title is anchored, in axes fraction (as set_label_coords takes it)."""
        display = label.get_transform().transform(label.get_position())
        return [round(float(v), 5) for v in ax.transAxes.inverted().transform(display)]

    axes = {
        name: {
            "bbox": frac(ax.get_window_extent(renderer)),
            "xlim": [float(v) for v in ax.get_xlim()],
            "ylim": [float(v) for v in ax.get_ylim()],
            "xlog": ax.get_xscale() == "log",
            "ylog": ax.get_yscale() == "log",
            "xlabel": anchor(ax, ax.xaxis.label),
            "ylabel": anchor(ax, ax.yaxis.label),
        }
        for name, ax in pads.items()
    }
    return {"elements": elements, "axes": axes}
