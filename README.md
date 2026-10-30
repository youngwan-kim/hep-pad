# hep-pad

WYSIWYG editing for HEP plots. Every plot is a declarative YAML spec that references
histograms in ROOT files and is rendered with matplotlib + mplhep, so cosmetic changes
are edits to a spec instead of to plotting code.

## Install (development)

```sh
python3.13 -m venv .venv
.venv/bin/pip install -e ".[dev]"
```

## Usage

```sh
python tests/fixtures/make_fixture_root.py examples/sample.root   # sample inputs
hep-pad ls examples/sample.root                                # list plottable objects
hep-pad render examples/datamc.yaml -f pdf -f png              # writes next to the spec
hep-pad render examples/*.yaml -o out/ --strict                # batch, fail on broken layers
```

From Python:

```python
import heppad as hp
spec = hp.load("examples/datamc.yaml")
spec.label.text = ""                      # drop "Preliminary"
spec.pads["main"].legend.loc = "upper left"
hp.render(spec, base_dir="examples").save("out/datamc.pdf")
```

## Spec at a glance

See `examples/datamc.yaml`. Top-level keys: `style` (CMS, ATLAS, LHCb2, ALICE, ROOT),
`inputs` (aliases for ROOT files, relative to the spec), `figure`, `label`
(experiment label), `layout` (`pads: [main, ratio]`), and `pads.<name>` with `xaxis`,
`yaxis`, `legend`, `layers`, `annotations`.

Layer kinds: `histogram`, `stack`, `errorband`, `graph`, `hist2d`, `ratio`, `pull`.
A `ref` can be a list, in which case the histograms are summed. Histogram ops
(`flow: fold`, `rebin`, `xrange`, `scale`, `normalize`) are applied at render time.
A layer that fails to load becomes a warning rather than aborting the plot.

Every drawn artist is tagged with its spec path (e.g. `pads.main.layers.bkg.members.0`,
`pads.main.legend`, `label`), which appears as the element id in SVG output, and
`RenderResult.elements()` returns their bounding boxes. The editor uses this to map
clicks on the plot back to the spec.

## Histograms from trees

A ref with `expr` fills a histogram from a TTree at render time (`path` is the tree), so
plots can come straight from ntuples. It works anywhere a histogram ref does (stacks,
ratios, systematics, remote URLs), and exported scripts fill it the same way:

```yaml
ref: {file: sample, path: Events, expr: Muon_pt, bins: [40, 0, 200],
      cut: 'nMuon >= 2 && abs(Muon_eta) < 2.4', weight: genWeight}
# 2D (hist2d layers): add yexpr and ybins
ref: {file: sample, path: Events, expr: Muon_eta, bins: [24, -2.4, 2.4],
      yexpr: Muon_pt, ybins: [0, 10, 20, 30, 50, 80, 120, 200]}
```

- `bins` is `[n, lo, hi]` or a list of more than three edges. Under/overflow go to flow bins,
  and a value on a bin's upper edge goes to the next bin, as in ROOT.
- Expressions are Python over branch names: arithmetic, comparisons, `lo < x < hi`,
  ROOT-style `&&`, `||`, `!`, numpy functions (`abs`, `sqrt`, `exp`, `log`, `sin`, `where`, …),
  indexing such as `Muon_pt[:, 0]`, and per-event `sum`, `max`, `min`, `any`, `all`, `count`,
  `num`. Jagged values, cuts and weights broadcast per event (an event-level cut such as
  `nMuon >= 2` and an object-level one such as `Muon_pt > 20` both work). Missing values,
  e.g. `max()` of an event without muons, are skipped.
- Only branch names and those functions are allowed, but treat a spec from someone else
  like a script: its expressions are evaluated.
- In the editor, expand a tree in the browser and click a branch: the panel suggests bins
  from the first 100k entries, and the Inspector edits expression, cut, weight and bins.

## Remote inputs

An input can be a URL instead of a path, read by uproot through fsspec:

```yaml
inputs:
  sample: ssh://me@lxplus.cern.ch/afs/cern.ch/user/m/me/sample.root
  data: https://example.org/files/data.root
```

Install the extra with `pip install -e ".[remote]"` (ssh/sftp via paramiko, http(s)
via aiohttp); `root://` also needs `fsspec-xrootd` and the XRootD Python bindings.
SSH uses your agent and default keys (paramiko does not read `~/.ssh/config`, so give
the full user@host). URLs are kept as-is when saving and in exported scripts. In the
editor, type a folder URL into the browser's path box to browse it. Remote reads are
cached for 60 s, since there is no cheap way to check whether a remote file changed.

## Systematic uncertainties (pre-fit)

Histograms and stacks take `systematics`:

```yaml
systematics:
  - {kind: shape}                                  # every "<nominal>_<source>Up/Down" in the file
  - {kind: shape, up: '{dir}/{source}Up/{name}', down: '{dir}/{source}Down/{name}', exclude: ['^stat_']}
  - {kind: norm, source: lumi, up: 0.016}          # flat, symmetric unless `down` is given
  - {kind: envelope, source: scale, variations: [muR0p5, muR2, muF0p5, muF2]}
syst_groups:                                       # regexes over source names; the rest is "Other"
  Detector: ['^JE', '^PU$']
  Theory: ['scale', '^pdf']
```

On a stack, `systematics` apply to every member; a member's own `systematics` only
to it. A source's shifts add linearly across members, sources add in quadrature,
and up/down stay asymmetric (`symmetrize: max | average` to change that). A missing
down variation mirrors the up one.

Bands (`errorband`, and a ratio's `den_band_content`) show `stat`, `syst`, `total`,
or a list of items added in quadrature: `[stat, Detector]`, `[Theory]`, `[JES]`.
`relative: true` draws 1 ± error / nominal for ratio pads, `style: lines` draws
only the edges. See `examples/datamc_syst.yaml` and `examples/datamc_breakdown.yaml`.

## Tests

```sh
.venv/bin/pytest
```
