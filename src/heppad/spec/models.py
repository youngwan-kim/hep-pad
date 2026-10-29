"""Declarative plot specification.

A spec fully describes a plot: style, experiment label, pad layout, and the
layers drawn in each pad. Data is referenced (file + object path), never
embedded, so the same spec can be re-rendered when the inputs change.
"""

from __future__ import annotations

from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

SPEC_VERSION = 1


class _Model(BaseModel):
    model_config = ConfigDict(extra="forbid", validate_assignment=True)


# --------------------------------------------------------------------------- data


class Ref(_Model):
    """Reference to an object in a ROOT file.

    ``file`` is either a key of ``PlotSpec.inputs`` or a path relative to the
    spec file's directory.
    """

    file: str
    path: str


# A single ref, or a list of refs that are summed bin by bin.
RefLike = Union[Ref, list[Ref]]


class HistOps(_Model):
    """Non-destructive operations applied to a 1D histogram at render time.

    Applied in order: flow folding, rebin, xrange, scale, normalize.
    """

    flow: Literal["none", "fold"] = "none"
    rebin: int | list[float] | None = None
    xrange: tuple[float, float] | None = None
    scale: float = 1.0
    normalize: bool = False


# -------------------------------------------------------------------- systematics


class ShapeSyst(_Model):
    """Up/down varied histograms found from path templates.

    Templates may use ``{path}`` (the nominal object path), ``{dir}`` and
    ``{name}`` (its directory and base name) and ``{source}``. With
    ``sources`` unset, every source whose up variation exists is used.
    """

    kind: Literal["shape"]
    up: str = "{path}_{source}Up"
    # None: only up variations exist; the down shift mirrors the up shift.
    down: str | None = "{path}_{source}Down"
    sources: list[str] | None = None
    # Regular expressions; matching sources are skipped.
    exclude: list[str] = []
    # Input holding the variations; default: the nominal's file.
    file: str | None = None


class NormSyst(_Model):
    """Flat relative uncertainty, e.g. luminosity or a cross section."""

    kind: Literal["norm"]
    source: str
    up: float
    # None: symmetric (same as up).
    down: float | None = None


class EnvelopeSyst(_Model):
    """One source given by the per-bin envelope of several variations (e.g. QCD scales)."""

    kind: Literal["envelope"]
    source: str
    variations: list[str]
    # Template for each variation; may use {path}, {dir}, {name}, {variation}.
    path: str = "{path}_{variation}"
    file: str | None = None


Systematic = Annotated[Union[ShapeSyst, NormSyst, EnvelopeSyst], Field(discriminator="kind")]

# Which uncertainty a band shows. "total" is stat and syst added in quadrature.
# A list combines items in quadrature: "stat", "syst" (all sources), a group name
# (see ``syst_groups``; "Other" holds ungrouped sources) or a single source name.
BandContent = Union[Literal["stat", "syst", "total"], list[str]]

# Named groups of systematic sources: {group: [regex, ...]} matched against source names.
SystGroups = dict[str, list[str]]


# ------------------------------------------------------------------------- layers


class _LayerBase(_Model):
    id: str
    visible: bool = True
    zorder: float | None = None


class HistogramLayer(_LayerBase, HistOps):
    kind: Literal["histogram"]
    ref: RefLike
    histtype: Literal["step", "fill", "errorbar", "band"] = "step"
    label: str | None = None
    color: str | None = None
    linewidth: float | None = None
    linestyle: str | None = None
    alpha: float | None = None
    hatch: str | None = None
    marker: str | None = None
    markersize: float | None = None
    yerr: Literal["auto", "sumw2", "poisson", "none"] = "auto"
    xerr: bool = False
    binwnorm: float | None = None
    systematics: list[Systematic] = []
    symmetrize: Literal["none", "max", "average"] = "none"
    syst_groups: SystGroups = {}


class StackMember(HistOps):
    ref: RefLike
    label: str | None = None
    color: str | None = None
    edgecolor: str | None = None
    hatch: str | None = None
    # Sources affecting only this member (e.g. its cross section).
    systematics: list[Systematic] = []


class StackLayer(_LayerBase):
    """Stacked histograms.

    Systematics here apply to every member; a source's shifts add linearly
    across members (fully correlated), different sources add in quadrature.
    """

    kind: Literal["stack"]
    members: list[StackMember]
    histtype: Literal["fill", "step"] = "fill"
    linewidth: float | None = None
    alpha: float | None = None
    binwnorm: float | None = None
    systematics: list[Systematic] = []
    symmetrize: Literal["none", "max", "average"] = "none"
    syst_groups: SystGroups = {}


class ErrorBandLayer(_LayerBase):
    """Uncertainty band around another layer (e.g. stat. unc. on a stack total)."""

    kind: Literal["errorband"]
    of: str
    content: BandContent = "stat"
    # Draw 1 +- error/nominal instead of nominal +- error (for ratio pads).
    relative: bool = False
    # "lines" draws only the upper and lower edges, for comparing bands side by side.
    style: Literal["fill", "lines"] = "fill"
    label: str | None = "Stat. unc."
    hatch: str | None = "////"
    color: str = "gray"
    facecolor: str = "none"
    alpha: float | None = None
    linewidth: float | None = None
    linestyle: str | None = None


class GraphLayer(_LayerBase):
    kind: Literal["graph"]
    ref: Ref
    label: str | None = None
    color: str | None = None
    marker: str | None = "o"
    markersize: float | None = None
    linestyle: str | None = "none"
    linewidth: float | None = None
    xerr: bool = True
    yerr: bool = True
    capsize: float | None = None


class Hist2DLayer(_LayerBase):
    kind: Literal["hist2d"]
    ref: RefLike
    cmap: str | None = None
    logz: bool = False
    zrange: tuple[float, float] | None = None
    cbar: bool = True
    cbar_label: str | None = None
    cmin: float | None = None
    bin_labels: bool = False
    bin_labels_format: str = "{:.2f}"
    scale: float = 1.0


class RatioLayer(_LayerBase):
    """num / den, where num and den are ids of histogram or stack layers."""

    kind: Literal["ratio"]
    num: str
    den: str
    histtype: Literal["errorbar", "step"] = "errorbar"
    label: str | None = None
    color: str | None = "black"
    marker: str | None = None
    markersize: float | None = None
    den_band: bool = True
    den_band_content: BandContent = "stat"
    den_band_hatch: str | None = "////"
    den_band_color: str = "gray"


class PullLayer(_LayerBase):
    """(num - den) / sqrt(var_num + var_den)."""

    kind: Literal["pull"]
    num: str
    den: str
    color: str | None = "gray"
    label: str | None = None


Layer = Annotated[
    Union[
        HistogramLayer,
        StackLayer,
        ErrorBandLayer,
        GraphLayer,
        Hist2DLayer,
        RatioLayer,
        PullLayer,
    ],
    Field(discriminator="kind"),
]


# -------------------------------------------------------------------- annotations


class TextAnnotation(_Model):
    kind: Literal["text"]
    text: str
    xy: tuple[float, float]
    coords: Literal["axes", "data"] = "axes"
    fontsize: float | None = None
    color: str | None = None
    ha: Literal["left", "center", "right"] = "left"
    va: Literal["top", "center", "bottom", "baseline"] = "top"
    rotation: float = 0
    fontweight: Literal["normal", "bold"] = "normal"
    fontstyle: Literal["normal", "italic"] = "normal"


class LineAnnotation(_Model):
    kind: Literal["hline", "vline"]
    at: float
    color: str = "black"
    linestyle: str = "--"
    linewidth: float = 1.0


Annotation = Annotated[
    Union[TextAnnotation, LineAnnotation], Field(discriminator="kind")
]


# ---------------------------------------------------------------------- axes/pads


class Axis(_Model):
    label: str | None = None
    range: tuple[float, float] | None = None
    log: bool = False
    label_loc: Literal["left", "center", "right", "top", "bottom"] | None = None
    ticklabels: bool = True


class Legend(_Model):
    show: bool = True
    loc: str = "best"
    # Anchor point in axes fraction; ``loc`` then names the legend corner placed there.
    bbox: tuple[float, float] | None = None
    ncol: int = 1
    fontsize: float | None = None
    frameon: bool | None = None
    title: str | None = None
    # Entry labels in the desired order; unlisted entries follow in draw order.
    order: list[str] | None = None
    reverse: bool = False


class ExpLabel(_Model):
    show: bool = True
    experiment: Literal["CMS", "ATLAS", "LHCb", "ALICE"] = "CMS"
    text: str = "Preliminary"
    data: bool = True
    # int listed first so 138 stays "138", not "138.0".
    lumi: int | float | str | None = None
    com: int | float | str | None = 13
    year: str | int | None = None
    loc: int = 0
    rlabel: str | None = None
    llabel: str | None = None
    fontsize: float | None = None


class Pad(_Model):
    """One axes, placed in a cell (or span of cells) of the layout grid."""

    id: str
    row: int = 0
    col: int = 0
    rowspan: int = 1
    colspan: int = 1
    # Share the x axis (range and scale) with another pad, e.g. a ratio pad with its main pad.
    sharex: str | None = None
    label: ExpLabel | None = None
    xaxis: Axis = Axis()
    yaxis: Axis = Axis()
    legend: Legend = Legend()
    layers: list[Layer] = []
    annotations: list[Annotation] = []


class Margins(_Model):
    """Distance from each canvas edge to the pad grid, as a fraction of the canvas.

    ``None`` uses the style's default (matplotlib ``figure.subplot.*``).
    """

    left: float | None = None
    right: float | None = None
    top: float | None = None
    bottom: float | None = None


class Layout(_Model):
    rows: int = Field(1, ge=1)
    cols: int = Field(1, ge=1)
    height_ratios: list[float] | None = None
    width_ratios: list[float] | None = None
    margins: Margins = Margins()
    # Gaps between pads, as a fraction of the average pad size (matplotlib convention).
    hspace: float | None = None
    wspace: float | None = None


class Canvas(_Model):
    """Canvas size in inches; exports are exactly this size (never cropped)."""

    width: float = Field(10, gt=0)
    height: float = Field(10, gt=0)
    dpi: float = Field(100, gt=0)


class PlotSpec(_Model):
    version: int = SPEC_VERSION
    style: Literal["CMS", "ATLAS", "LHCb2", "ALICE", "ROOT"] = "CMS"
    inputs: dict[str, str] = {}
    canvas: Canvas = Canvas()
    layout: Layout = Layout()
    pads: list[Pad] = [Pad(id="main", label=ExpLabel())]

    @model_validator(mode="after")
    def _check(self) -> "PlotSpec":
        lay = self.layout
        for name, ratios, n in (
            ("height_ratios", lay.height_ratios, lay.rows),
            ("width_ratios", lay.width_ratios, lay.cols),
        ):
            if ratios is not None and len(ratios) != n:
                raise ValueError(f"layout.{name} has {len(ratios)} entries for {n} rows/cols")
        pad_ids = [p.id for p in self.pads]
        _no_dupes("pad", pad_ids)
        for p in self.pads:
            if not (0 <= p.row and p.row + p.rowspan <= lay.rows
                    and 0 <= p.col and p.col + p.colspan <= lay.cols):
                raise ValueError(f"pad {p.id!r} lies outside the {lay.rows}x{lay.cols} grid")
            if p.sharex is not None and p.sharex not in pad_ids:
                raise ValueError(f"pad {p.id!r} shares x with unknown pad {p.sharex!r}")
        _no_dupes("layer", [layer.id for p in self.pads for layer in p.layers])
        return self

    def pad(self, pad_id: str) -> Pad:
        for p in self.pads:
            if p.id == pad_id:
                return p
        raise KeyError(pad_id)

    def layer(self, layer_id: str):
        for p in self.pads:
            for layer in p.layers:
                if layer.id == layer_id:
                    return layer
        raise KeyError(layer_id)


def _no_dupes(what: str, ids: list[str]) -> None:
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        raise ValueError(f"duplicate {what} ids: {sorted(dupes)}")
