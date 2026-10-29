import pytest
from pydantic import ValidationError

from heppad.spec import io
from heppad.spec.models import PlotSpec

from conftest import EXAMPLES


@pytest.mark.parametrize("path", EXAMPLES, ids=lambda p: p.stem)
def test_yaml_roundtrip(path):
    spec = io.load(path)
    assert io.loads(io.dumps(spec)) == spec


def test_dump_omits_defaults():
    data = io.to_dict(PlotSpec())
    assert data == {"version": 1}


def _pads(*pads, **layout):
    return {"layout": layout, "pads": list(pads)}


def test_pad_outside_grid_rejected():
    with pytest.raises(ValidationError, match="outside the 1x1 grid"):
        io.from_dict(_pads({"id": "a", "row": 1}))


def test_ratio_length_must_match_grid():
    with pytest.raises(ValidationError, match="height_ratios"):
        io.from_dict(_pads({"id": "a"}, rows=2, height_ratios=[1]))


def test_sharex_must_exist():
    with pytest.raises(ValidationError, match="unknown pad"):
        io.from_dict(_pads({"id": "a", "sharex": "nope"}))


def test_duplicate_pad_ids_rejected():
    with pytest.raises(ValidationError, match="duplicate pad ids"):
        io.from_dict(_pads({"id": "a"}, {"id": "a", "row": 1}, rows=2))


def test_lumi_keeps_integers():
    spec = io.from_dict(_pads({"id": "a", "label": {"lumi": 138, "com": 13.6}}))
    label = spec.pad("a").label
    assert label.lumi == 138 and isinstance(label.lumi, int)
    assert label.com == 13.6


def test_duplicate_layer_ids_rejected():
    layer = {"id": "a", "kind": "histogram", "ref": {"file": "f", "path": "h"}}
    with pytest.raises(ValidationError, match="duplicate layer ids"):
        io.from_dict(_pads({"id": "a", "layers": [layer, layer]}))


def test_unknown_fields_rejected():
    with pytest.raises(ValidationError):
        io.from_dict(_pads({"id": "a", "label": {"lumii": 138}}))


def test_unknown_layer_kind_rejected():
    with pytest.raises(ValidationError):
        io.from_dict(_pads({"id": "p", "layers": [{"id": "a", "kind": "pie"}]}))


def test_newer_version_rejected():
    with pytest.raises(ValueError, match="newer"):
        io.from_dict({"version": 99})


def test_ref_list_is_accepted():
    spec = io.from_dict(_pads({"id": "p", "layers": [{
        "id": "a", "kind": "histogram",
        "ref": [{"file": "f", "path": "h1"}, {"file": "f", "path": "h2"}],
    }]}))
    assert len(spec.layer("a").ref) == 2
