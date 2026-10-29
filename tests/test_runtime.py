"""The helpers copied into generated scripts."""

import numpy as np
import pytest

from heppad.codegen import runtime as rt
from heppad.codegen.runtime import Hist1D


@pytest.fixture
def fake_inputs(monkeypatch):
    """Serve in-memory histograms to ``load``: values include flow bins."""
    store = {}

    def read(file, path):
        return store[path]

    monkeypatch.setattr(rt, "read", read)
    monkeypatch.setattr(rt, "object_paths", lambda key: list(store))
    monkeypatch.setattr(rt, "BASE", None)

    def put(path, values, variances=None, edges=None):
        values = np.asarray(values, float)
        n = len(values) - 2
        store[path] = {
            "kind": "h1",
            "edges": np.arange(n + 1, dtype=float) if edges is None else np.asarray(edges, float),
            "values": values,
            "variances": values.copy() if variances is None else np.asarray(variances, float),
        }

    return put


def h(values, variances=None, edges=None):
    values = np.asarray(values, float)
    edges = np.arange(len(values) + 1, dtype=float) if edges is None else np.asarray(edges, float)
    return Hist1D(edges, values, values.copy() if variances is None else np.asarray(variances, float))


def test_flow_dropped_by_default(fake_inputs):
    fake_inputs("a", [1, 2, 3, 4, 5])
    assert rt.hist1d([("f", "a")]).values.tolist() == [2, 3, 4]


def test_fold_flow(fake_inputs):
    fake_inputs("a", [1, 2, 3, 4, 5])
    assert rt.hist1d([("f", "a")], flow="fold").values.tolist() == [3, 3, 9]


def test_sum_of_refs(fake_inputs):
    fake_inputs("a", [0, 1, 2, 0])
    fake_inputs("b", [0, 10, 20, 0])
    assert rt.hist1d([("f", "a"), ("f", "b")]).values.tolist() == [11, 22]


def test_sum_checks_binning(fake_inputs):
    fake_inputs("a", [0, 1, 2, 0])
    fake_inputs("b", [0, 1, 2, 0], edges=[0, 1, 3])
    with pytest.raises(ValueError, match="binning"):
        rt.hist1d([("f", "a"), ("f", "b")])


def test_rebin_int_drops_partial_group(fake_inputs):
    fake_inputs("a", [0, 1, 2, 3, 4, 5, 0])
    out = rt.hist1d([("f", "a")], rebin=2)
    assert out.values.tolist() == [3, 7]
    assert out.edges.tolist() == [0, 2, 4]


def test_rebin_edges(fake_inputs):
    fake_inputs("a", [0, 1, 2, 3, 4, 5, 0])
    out = rt.hist1d([("f", "a")], rebin=[1, 2, 5])
    assert out.values.tolist() == [2, 12]
    assert out.variances.tolist() == [2, 12]


def test_rebin_rejects_unknown_edge(fake_inputs):
    fake_inputs("a", [0, 1, 2, 3, 0])
    with pytest.raises(ValueError, match="not existing bin edges"):
        rt.hist1d([("f", "a")], rebin=[0, 1.5, 3])


def test_xrange(fake_inputs):
    fake_inputs("a", [0, 1, 2, 3, 4, 0])
    out = rt.hist1d([("f", "a")], xrange=[0.5, 3])
    assert out.edges.tolist() == [1, 2, 3]
    assert out.values.tolist() == [2, 3]


def test_scale_squares_variances(fake_inputs):
    fake_inputs("a", [0, 1, 2, 0], variances=[0, 1, 4, 0])
    out = rt.hist1d([("f", "a")], scale=3)
    assert out.values.tolist() == [3, 6]
    assert out.variances.tolist() == [9, 36]


def test_normalize_to_scale(fake_inputs):
    fake_inputs("a", [0, 1, 3, 0])
    assert rt.hist1d([("f", "a")], normalize=True).values.sum() == pytest.approx(1)
    assert rt.hist1d([("f", "a")], normalize=True, scale=2).values.sum() == pytest.approx(2)


def test_cached_arrays_are_not_mutated(fake_inputs):
    fake_inputs("a", [1, 2, 3, 4, 5])
    rt.hist1d([("f", "a")], flow="fold")
    assert rt.hist1d([("f", "a")]).values.tolist() == [2, 3, 4]


def test_ratio_handles_zero_denominator():
    r, num_err, den_err = rt.ratio(h([2, 4]), h([0, 2]))
    assert np.isnan(r[0]) and r[1] == 2
    assert num_err[1] == pytest.approx(1.0)
    assert den_err[1] == pytest.approx(np.sqrt(2) / 2)


def test_pull():
    p = rt.pull(h([10, 0], variances=[4, 0]), h([4, 0], variances=[5, 0]))
    assert p.tolist() == [2.0, 0.0]


def test_auto_yerr():
    assert rt.auto_yerr(h([1, 2])) is True
    assert rt.auto_yerr(h([1, 2], variances=[4, 4])).tolist() == [2, 2]


def test_sort_legend():
    handles, labels = rt.sort_legend([1, 2, 3], ["a", "b", "c"], order=["c"], reverse=True)
    assert labels == ["c", "b", "a"]


# ------------------------------------------------------------------ systematics
# Histograms below have 2 bins plus flow: values [uflow, b1, b2, oflow].


def comp(path, syst=(), **ops):
    return {"refs": [("f", path)], "ops": ops, "syst": list(syst)}


def test_norm_systematic(fake_inputs):
    fake_inputs("a", [0, 10, 20, 0])
    s = rt.systematics([comp("a")], common=[{"kind": "norm", "source": "lumi", "up": 0.1, "down": 0.2}])
    assert s.up.tolist() == pytest.approx([1, 2])
    assert s.down.tolist() == pytest.approx([2, 4])


def test_same_source_is_correlated_across_components(fake_inputs):
    """Shifts of one source add linearly: 1 + 1 = 2, not sqrt(2)."""
    for name in ("a", "b"):
        fake_inputs(name, [0, 10, 10, 0])
        fake_inputs(f"{name}_JESUp", [0, 11, 10, 0])
        fake_inputs(f"{name}_JESDown", [0, 9, 10, 0])
    s = rt.systematics([comp("a"), comp("b")], common=[{"kind": "shape"}])
    assert s.up.tolist() == pytest.approx([2, 0])
    assert s.down.tolist() == pytest.approx([2, 0])
    assert list(s.sources) == ["JES"]


def test_sources_add_in_quadrature(fake_inputs):
    fake_inputs("a", [0, 10, 0])
    fake_inputs("a_XUp", [0, 13, 0])
    fake_inputs("a_YUp", [0, 14, 0])
    s = rt.systematics([comp("a", [{"kind": "shape", "down": None}])])
    assert s.up.tolist() == pytest.approx([5])


def test_missing_down_is_mirrored_and_reported(fake_inputs):
    fake_inputs("a", [0, 10, 0])
    fake_inputs("a_PUUp", [0, 12, 0])
    s = rt.systematics([comp("a", [{"kind": "shape"}])])
    assert s.up.tolist() == s.down.tolist() == pytest.approx([2])
    assert s.missing == [("PU down", "a_PUDown")]


def test_same_sign_variations(fake_inputs):
    """Up and down both raise the yield: no downward error."""
    fake_inputs("a", [0, 10, 0])
    fake_inputs("a_XUp", [0, 12, 0])
    fake_inputs("a_XDown", [0, 11, 0])
    s = rt.systematics([comp("a", [{"kind": "shape"}])])
    assert s.up.tolist() == pytest.approx([2])
    assert s.down.tolist() == pytest.approx([0])


def test_symmetrize(fake_inputs):
    fake_inputs("a", [0, 10, 0])
    fake_inputs("a_XUp", [0, 12, 0])
    fake_inputs("a_XDown", [0, 9, 0])
    assert rt.systematics([comp("a", [{"kind": "shape"}])], symmetrize="max").down.tolist() == [2]
    assert rt.systematics([comp("a", [{"kind": "shape"}])], symmetrize="average").up.tolist() == [1.5]


def test_envelope(fake_inputs):
    fake_inputs("a", [0, 10, 10, 0])
    fake_inputs("a_s0", [0, 12, 9, 0])
    fake_inputs("a_s1", [0, 7, 10.5, 0])
    s = rt.systematics([comp("a", [{"kind": "envelope", "source": "scale", "variations": ["s0", "s1"]}])])
    assert s.up.tolist() == pytest.approx([2, 0.5])
    assert s.down.tolist() == pytest.approx([3, 1])


def test_discovery_explicit_sources_and_exclude(fake_inputs):
    fake_inputs("d/a", [0, 10, 0])
    for src in ("JES", "JER", "stat_bin1"):
        fake_inputs(f"d/a_{src}Up", [0, 11, 0])
        fake_inputs(f"d/a_{src}Down", [0, 9, 0])
    fake_inputs("d/other_JESUp", [0, 50, 0])  # belongs to another nominal
    discovered = rt.systematics([comp("d/a", [{"kind": "shape", "exclude": ["^stat_"]}])])
    assert sorted(discovered.sources) == ["JER", "JES"]
    explicit = rt.systematics([comp("d/a", [{"kind": "shape", "sources": ["JES"]}])])
    assert list(explicit.sources) == ["JES"]
    templated = rt.systematics([comp("d/a", [{"kind": "shape", "up": "{dir}/{name}_{source}Up",
                                               "down": "{dir}/{name}_{source}Down"}])])
    assert sorted(templated.sources) == ["JER", "JES", "stat_bin1"]


def test_variations_get_nominal_normalization(fake_inputs):
    """A pure normalization shift survives normalize=True."""
    fake_inputs("a", [0, 10, 10, 0])
    fake_inputs("a_NUp", [0, 11, 11, 0])
    s = rt.systematics([comp("a", [{"kind": "shape", "down": None}], normalize=True)])
    assert s.up.tolist() == pytest.approx([0.05, 0.05])


def test_component_without_variation_contributes_nothing(fake_inputs):
    fake_inputs("a", [0, 10, 0])
    fake_inputs("b", [0, 10, 0])
    fake_inputs("a_XUp", [0, 12, 0])
    fake_inputs("a_XDown", [0, 8, 0])
    s = rt.systematics([comp("a"), comp("b")], common=[{"kind": "shape", "sources": ["X"]}])
    assert s.up.tolist() == pytest.approx([2])
    assert ("X up", "b_XUp") in s.missing


# ------------------------------------------------------------ groups and bands


def _syst(**sources):
    return rt.Syst(None, None, {k: (np.array(v[0], float), np.array(v[1], float)) for k, v in sources.items()}, [])


def test_group_sources_other_catches_the_rest():
    groups = rt.group_sources(["JES", "JER", "lumi", "tt_scale"], {"JEC": ["^JE"], "Theory": ["scale"]})
    assert groups == {"JEC": ["JES", "JER"], "Theory": ["tt_scale"], "Other": ["lumi"]}


def test_band_errors_combinations():
    hh = h([100.0], variances=[9.0])
    syst = _syst(JES=([4], [4]), lumi=([1], [2]))
    assert [x.tolist() for x in rt.band_errors(hh, syst, ["stat"])] == [[3], [3]]
    assert [x.tolist() for x in rt.band_errors(hh, syst, ["stat", "JES"])] == [[5], [5]]
    groups = {"Detector": ["^JE"]}
    down, up = rt.band_errors(hh, syst, ["Other"], groups)
    assert (down.tolist(), up.tolist()) == ([1], [2])
    # Each source counts once even if named twice (via "syst" and its group).
    down, _ = rt.band_errors(hh, syst, ["syst", "Detector", "stat"], groups)
    assert down.tolist() == pytest.approx([np.sqrt(9 + 16 + 1)])


def test_band_errors_without_systematics():
    hh = h([100.0], variances=[4.0])
    assert [x.tolist() for x in rt.band_errors(hh, None, ["stat", "syst"])] == [[2], [2]]
