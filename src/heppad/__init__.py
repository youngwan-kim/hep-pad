"""hep-pad: declarative, editable HEP plots rendered with mplhep."""

from . import spec
from .render.figure import RenderResult, render
from .spec.io import dumps, load, loads, save
from .spec.models import PlotSpec

__all__ = ["PlotSpec", "RenderResult", "dumps", "load", "loads", "render", "save"]
__version__ = "0.1.0"
