"""Histograms filled from a TTree (refs with ``expr``)."""

import awkward as ak
import numpy as np
import pytest
import uproot
from pydantic import ValidationError

import heppad as hw
from heppad.codegen.runtime import read
from heppad.data import root
from heppad.spec.models import HistogramLayer, Ref, StackLayer, StackMember


@pytest.fixture(scope="module")
def sample(workdir):
    return str(workdir / "sample.root")


@pytest.fixture(scope="module")
def events(sample):
    return uproot.open(sample)["Events"].arrays(["mass", "weight", "nMuon", "Muon_pt", "Muon_eta"])


def test_tree_hist_equals_stored_hist(sample):
    """The fixture's tree holds the events behind data/h_mass: identical, flow included."""
    stored = read(sample, "data/h_mass")
    filled = read(sample, "Events", {"expr": "mass", "bins": [60, 60, 120]})
    assert np.array_equal(filled["edges"], stored["edges"])
    assert np.array_equal(filled["values"], stored["values"])


def test_flow_bins_follow_root(sample, events):
    """Under/overflow are kept, and a value on the upper edge is overflow, as in ROOT."""
    h = read(sample, "Events", {"expr": "mass", "bins": [1, 80, 100]})
    mass = ak.to_numpy(events.mass)
    assert h["values"].tolist() == [(mass < 80).sum(), ((mass >= 80) & (mass < 100)).sum(), (mass >= 100).sum()]


@pytest.mark.parametrize("cut", ["Muon_pt > 20 && nMuon >= 2", "(Muon_pt > 20) & (nMuon >= 2)",
                                 "!(Muon_pt <= 20 || nMuon < 2)"])
def test_jagged_cut_and_weight(sample, events, cut):
    h = read(sample, "Events", {"expr": "Muon_pt", "bins": [20, 0, 200], "cut": cut, "weight": "weight"})
    pt, w, n = ak.broadcast_arrays(events.Muon_pt, events.weight, events.nMuon)
    keep = (pt > 20) & (n >= 2)
    pt, w = ak.to_numpy(ak.flatten(pt[keep])), ak.to_numpy(ak.flatten(w[keep]))
    edges = np.linspace(0, 200, 21)
    assert np.allclose(h["values"][1:-1], np.histogram(pt, edges, weights=w)[0])
    assert np.allclose(h["variances"][1:-1], np.histogram(pt, edges, weights=w**2)[0])
    assert h["values"][-1] == pytest.approx(w[pt >= 200].sum())


def test_chained_comparison_and_functions(sample, events):
    mass = ak.to_numpy(events.mass)
    h = read(sample, "Events", {"expr": "mass", "bins": [1, 0, 1000], "cut": "80 < mass < 100"})
    assert h["values"][1] == ((mass > 80) & (mass < 100)).sum()
    # max() of an event without muons is missing and skipped.
    h = read(sample, "Events", {"expr": "max(Muon_pt)", "bins": [10, 0, 400]})
    assert h["values"].sum() == ak.sum(events.nMuon > 0)


def test_2d(sample, events):
    h = read(sample, "Events", {"expr": "Muon_eta", "bins": [10, -2.5, 2.5],
                                "yexpr": "Muon_pt", "ybins": [0, 20, 50, 100, 300]})
    assert h["kind"] == "h2" and h["values"].shape == (12, 6)
    assert h["values"].sum() == ak.sum(events.nMuon)


@pytest.mark.parametrize("expr, error", [
    ("Muon_ptt", "no branch 'Muon_ptt'"),
    ("Muon_pt +", "cannot parse"),
    ("__import__('os')", "no branch '__import__'"),
    ("mass.__class__", "no branch 'mass.__class__'"),
    ("1 + 2", "use no branches"),
])
def test_bad_expressions(sample, expr, error):
    with pytest.raises((KeyError, ValueError), match=error):
        read(sample, "Events", {"expr": expr, "bins": [10, 0, 1]})


@pytest.mark.parametrize("fields, error", [
    ({"expr": "x"}, "bins is required"),
    ({"bins": [10, 0, 1]}, "only apply to tree refs"),
    ({"expr": "x", "bins": [10, 1, 0]}, "lo < hi"),
    ({"expr": "x", "bins": [0, 2, 1, 3]}, "increasing edges"),
    ({"expr": "x", "bins": [10, 0, 1], "ybins": [10, 0, 1]}, "ybins needs yexpr"),
    ({"expr": "x", "bins": [10, 0, 1], "yexpr": "y"}, "ybins is required"),
])
def test_ref_validation(fields, error):
    with pytest.raises(ValidationError, match=error):
        Ref(file="f", path="Events", **fields)


def test_plain_refs_serialize_unchanged():
    assert Ref(file="f", path="h").model_dump(mode="json", exclude_defaults=True) == {"file": "f", "path": "h"}


def test_tree_refs_in_stack_with_ops(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    tree = dict(file="sample", path="Events", expr="mass", bins=[60, 60, 120])
    spec.pad("main").layers = [StackLayer(id="st", kind="stack", members=[
        StackMember(ref=Ref(**tree, cut="weight > 1"), rebin=2, scale=0.5, label="a"),
        StackMember(ref=Ref(**tree, cut="weight <= 1"), rebin=2, label="b"),
    ])]
    spec.pad("ratio").layers = []
    result = hw.render(spec, workdir)
    assert result.warnings == []


def test_missing_branch_is_a_layer_warning(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    spec.pad("main").layers.append(HistogramLayer(
        id="typo", kind="histogram", ref=Ref(file="sample", path="Events", expr="mas", bins=[60, 60, 120])))
    result = hw.render(spec, workdir)
    assert len(result.warnings) == 1 and "no branch 'mas'" in result.warnings[0]


def test_branches_and_preview(sample):
    assert {"name": "Muon_pt", "type": "double[]", "jagged": True} in root.tree_branches(sample, "Events")
    p = root.tree_preview(sample, "Events", "nMuon")
    assert p["bins"] == [10, -0.5, 9.5]  # integers: one bin each
    p = root.tree_preview(sample, "Events", "mass", "mass > 90")
    assert p["min"] > 90 and p["bins"][0] == 50 and sum(p["values"]) == p["count"]


def test_cached_read_keys_on_tree(sample):
    a = root.cached_read(sample, "Events", {"expr": "mass", "bins": [60, 60, 120]})
    b = root.cached_read(sample, "Events", {"expr": "mass", "bins": [60, 60, 120], "cut": "mass > 90"})
    assert a["values"].sum() > b["values"].sum()
    assert root.cached_read(sample, "Events", {"expr": "mass", "bins": [60, 60, 120]}) is a
