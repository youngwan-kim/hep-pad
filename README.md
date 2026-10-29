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
