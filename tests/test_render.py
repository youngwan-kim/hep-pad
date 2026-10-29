import re

import matplotlib.pyplot as plt
import pytest

import heppad as hw
from heppad.spec import io

from conftest import EXAMPLES


@pytest.mark.parametrize("name", [p.stem for p in EXAMPLES])
@pytest.mark.parametrize("fmt", ["png", "pdf", "svg"])
def test_examples_render(workdir, name, fmt):
    result = hw.render(hw.load(workdir / f"{name}.yaml"), workdir)
    assert result.warnings == []
    assert len(result.to_bytes(fmt)) > 1000


def test_no_pyplot_figures_leak(workdir):
    for spec in EXAMPLES:
        hw.render(hw.load(workdir / spec.name), workdir).to_bytes("png")
    assert plt.get_fignums() == []


def test_elements_map_to_spec(workdir):
    result = hw.render(hw.load(workdir / "datamc.yaml"), workdir)
    elements = result.elements()["elements"]
    for gid in [
        "pads.main.label",
        "pads.main.layers.bkg.members.0",
        "pads.main.layers.bkg.members.2",
        "pads.main.layers.unc",
        "pads.main.layers.data",
        "pads.main.legend",
        "pads.main.yaxis",
        "pads.ratio.layers.r",
        "pads.ratio.xaxis",
    ]:
        assert gid in elements, gid
        x0, y0, x1, y1 = elements[gid]["bbox"]
        assert 0 <= x0 <= x1 <= 1 and 0 <= y0 <= y1 <= 1
    # The ratio pad sits below the main pad (origin is top-left).
    axes = result.elements()["axes"]
    assert axes["ratio"]["bbox"][1] > axes["main"]["bbox"][3] - 1e-6


def test_svg_ids_match_elements(workdir):
    result = hw.render(hw.load(workdir / "datamc.yaml"), workdir)
    svg = result.to_bytes("svg").decode()
    ids = {i.split("@")[0] for i in re.findall(r'id="([^"]+)"', svg)}
    assert set(result.elements()["elements"]) <= ids


def test_broken_layer_becomes_warning(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    spec.layer("data").ref.path = "data/does_not_exist"
    result = hw.render(spec, workdir)
    assert any("'data'" in w for w in result.warnings)
    # The ratio depends on the data layer, so it fails too, but the rest renders.
    assert any("'r'" in w for w in result.warnings)
    result.to_bytes("png")  # the rest of the plot still renders


def test_hidden_layer_not_drawn(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    spec.layer("unc").visible = False
    elements = hw.render(spec, workdir).elements()["elements"]
    assert "pads.main.layers.unc" not in elements


def test_legend_order(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    spec.pad("main").legend.order = ["Drell-Yan", "Data"]
    result = hw.render(spec, workdir)
    texts = [t.get_text() for t in result.pads["main"].get_legend().get_texts()]
    assert texts[:2] == ["Drell-Yan", "Data"]


def test_label_text(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    result = hw.render(spec, workdir)
    texts = [a.get_text() for a in result.tagger.tagged["pads.main.label"]]
    assert "Preliminary" in texts
    assert any(t.startswith("138 ") and "(13 TeV)" in t for t in texts), texts


def test_simulation_not_duplicated(workdir):
    spec = io.from_dict({"pads": [{"id": "p", "label": {"data": False, "text": "Simulation Preliminary"}}]})
    texts = " ".join(a.get_text() for a in hw.render(spec).tagger.tagged["pads.p.label"])
    assert texts.count("Simulation") == 1


def test_ops_applied_through_spec(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    data = spec.layer("data")
    data.rebin = 2
    data.xrange = (70, 110)
    result = hw.render(spec, workdir)
    # Data no longer matches the MC binning, so only the ratio complains.
    assert result.warnings == ["layer 'r': ratio: binning differs"]
    # 20 bins of 2 GeV between 70 and 110: the data errorbar has 20 points.
    lines = [a for a in result.tagger.tagged["pads.main.layers.data"] if hasattr(a, "get_xdata")]
    assert any(len(line.get_xdata()) == 20 for line in lines)


def test_export_is_exactly_the_canvas(workdir):
    """No tight-bbox cropping, even for styles that request it (LHCb2)."""
    from PIL import Image
    import io as _io

    spec = hw.load(workdir / "efficiency.yaml")
    spec.style = "LHCb2"
    spec.canvas.width, spec.canvas.height, spec.canvas.dpi = 8, 6, 50
    png = hw.render(spec, workdir).to_bytes("png")
    assert Image.open(_io.BytesIO(png)).size == (400, 300)


def test_margins_and_grid_geometry():
    spec = io.from_dict({
        "layout": {"rows": 1, "cols": 2, "margins": {"left": 0.1, "right": 0.05, "top": 0.1, "bottom": 0.2}, "wspace": 0},
        "pads": [{"id": "l"}, {"id": "r", "col": 1}],
    })
    axes = hw.render(spec).elements()["axes"]
    assert axes["l"]["bbox"][0] == pytest.approx(0.1, abs=1e-3)
    assert axes["r"]["bbox"][2] == pytest.approx(0.95, abs=1e-3)
    assert axes["l"]["bbox"][1] == pytest.approx(0.1, abs=1e-3)   # top margin (origin top-left)
    assert axes["l"]["bbox"][3] == pytest.approx(0.8, abs=1e-3)
    assert axes["l"]["bbox"][2] == pytest.approx(axes["r"]["bbox"][0], abs=1e-3)  # wspace 0


def test_sharex_follows_main_pad(workdir):
    result = hw.render(hw.load(workdir / "datamc.yaml"), workdir)
    assert result.pads["ratio"].get_xlim() == (60, 120)


def test_systematics_breakdown(workdir):
    result = hw.render(hw.load(workdir / "datamc_syst.yaml"), workdir)
    assert result.warnings == []
    b = result.systematics["bkg"]
    names = [s["source"] for s in b["sources"]]
    assert set(names) == {"JES", "JER", "PU", "lumi", "tt_xsec", "tt_scale"}
    lumi = next(s for s in b["sources"] if s["source"] == "lumi")
    assert lumi["up"] == pytest.approx(0.016) and lumi["down"] == pytest.approx(0.016)
    assert b["missing"] == [["PU down", "mc/dy/h_mass_PUDown"]]
    # Sorted by size.
    sizes = [max(s["up"], s["down"]) for s in b["sources"]]
    assert sizes == sorted(sizes, reverse=True)


def test_syst_band_without_systematics_falls_back_to_stat(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    spec.layer("unc").content = "total"
    assert hw.render(spec, workdir).warnings == []


def test_breakdown_groups_and_stat(workdir):
    result = hw.render(hw.load(workdir / "datamc_breakdown.yaml"), workdir)
    assert result.warnings == []
    b = result.systematics["bkg"]
    groups = {g["group"]: g["sources"] for g in b["groups"]}
    assert groups == {"Detector": ["JER", "JES", "PU"], "Theory": ["tt_xsec", "tt_scale"], "Other": ["lumi"]}
    assert b["combined"]["up"] > b["total"]["up"] > 0 and b["stat"]["up"] > 0


def test_band_lines_style_and_relative(workdir):
    spec = hw.load(workdir / "datamc_breakdown.yaml")
    band = spec.layer("b_det")
    band.style = "lines"
    result = hw.render(spec, workdir)
    assert result.warnings == []
    # Two step lines (upper and lower edge), both around 1 in the ratio pad.
    artists = result.tagger.tagged["pads.ratio.layers.b_det"]
    assert len(artists) == 2
    for a in artists:
        values = a.get_data().values
        assert 0.8 < float(values[30]) < 1.2
