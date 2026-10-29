"""Write a small, deterministic ROOT file for tests and examples.

    python tests/fixtures/make_fixture_root.py [output.root]
"""

from __future__ import annotations

import sys
from pathlib import Path

import hist
import numpy as np
import pandas as pd
import uproot

DEFAULT = Path(__file__).with_name("sample.root")


def _mass_hist(samples: np.ndarray, weights: np.ndarray | None = None) -> hist.Hist:
    h = hist.Hist.new.Reg(60, 60, 120, name="mass").Weight()
    h.fill(samples, weight=1.0 if weights is None else weights)
    return h


def make(path: Path = DEFAULT) -> Path:
    rng = np.random.default_rng(42)
    lumi_weight = 0.8  # MC events carry a weight, so sumw2 != sumw

    dy = rng.standard_cauchy(60_000) * 2.5 + 91.19
    tt = 60 + rng.exponential(40, 6_000)
    vv = rng.uniform(60, 120, 2_000)

    h_dy = _mass_hist(dy, np.full(dy.size, lumi_weight))
    h_tt = _mass_hist(tt, np.full(tt.size, lumi_weight))
    h_vv = _mass_hist(vv, np.full(vv.size, lumi_weight))

    expected = (h_dy.values() + h_tt.values() + h_vv.values()) * 1.03
    centers = h_dy.axes[0].centers
    data = np.repeat(centers, rng.poisson(expected))
    h_data = hist.Hist.new.Reg(60, 60, 120, name="mass").Double()
    h_data.fill(data + rng.uniform(-0.5, 0.5, data.size))

    h2 = hist.Hist.new.Reg(20, -2.5, 2.5, name="eta").Reg(20, 0, 100, name="pt").Weight()
    eta, pt = rng.normal(0, 1.2, 20_000), rng.exponential(25, 20_000)
    h2.fill(eta, pt, weight=np.full(eta.size, 0.5))

    x = np.linspace(5, 95, 10)
    eff = 0.95 / (1 + np.exp(-(x - 25) / 5))
    graph = pd.DataFrame(
        {
            "x": x,
            "y": eff,
            "xerrors_low": np.full(x.size, 4.5),
            "xerrors_high": np.full(x.size, 4.5),
            "yerrors_low": np.full(x.size, 0.02),
            "yerrors_high": np.minimum(0.02, 1 - eff),
        }
    )

    # Systematic variations, named "<nominal>_<source>Up/Down" next to the nominal.
    variations = {}
    for name, events in (("dy", dy), ("tt", tt), ("vv", vv)):
        w = np.full(events.size, lumi_weight)
        variations[f"mc/{name}/h_mass_JESUp"] = _mass_hist(events * 1.002, w)
        variations[f"mc/{name}/h_mass_JESDown"] = _mass_hist(events * 0.998, w)
        smear = rng.normal(0, 0.4, events.size)
        variations[f"mc/{name}/h_mass_JERUp"] = _mass_hist(events + smear, w)
        variations[f"mc/{name}/h_mass_JERDown"] = _mass_hist(events + 0.5 * smear, w)
    # Only an up variation: the down shift must be mirrored.
    variations["mc/dy/h_mass_PUUp"] = _mass_hist(dy, np.full(dy.size, lumi_weight) * (1 + 0.0004 * (dy - 91)))
    # Six QCD scale variations for ttbar: the envelope is one source.
    for i, (a, b) in enumerate([(0.9, 0.0), (1.1, 0.0), (0.95, 0.001), (1.05, -0.001), (0.92, 0.002), (1.08, -0.002)]):
        variations[f"mc/tt/h_mass_scale{i}"] = _mass_hist(tt, np.full(tt.size, lumi_weight) * (a + b * (tt - 90)))

    path.parent.mkdir(parents=True, exist_ok=True)
    with uproot.recreate(path) as f:
        f["data/h_mass"] = h_data
        f["mc/dy/h_mass"] = h_dy
        f["mc/tt/h_mass"] = h_tt
        f["mc/vv/h_mass"] = h_vv
        f["mc/dy/h_eta_pt"] = h2
        f["eff/g_trig"] = uproot.as_TGraph(graph)
        for key, h in variations.items():
            f[key] = h
    return path


if __name__ == "__main__":
    print(make(Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT))
