"""The exported script must draw exactly what the editor shows."""

import subprocess
import sys

import numpy as np
import pytest
from matplotlib.image import imread

import heppad as hw
from heppad.codegen.generate import generate, lit

from conftest import EXAMPLES


@pytest.mark.parametrize("name", [p.stem for p in EXAMPLES])
def test_script_matches_editor(workdir, tmp_path, name):
    spec = hw.load(workdir / f"{name}.yaml")
    editor_png = tmp_path / "editor.png"
    hw.render(spec, workdir).save(editor_png)

    # Write the script somewhere else, so relative input paths are exercised.
    script_dir = tmp_path / "scripts"
    script_dir.mkdir()
    script = script_dir / f"{name}.py"
    script.write_text(generate(spec, workdir, script_dir=script_dir, output="script.png").source())
    run = subprocess.run([sys.executable, "-I", str(script)], capture_output=True, text=True,
                         env={"MPLBACKEND": "Agg", "PATH": ""})
    assert run.returncode == 0, run.stderr

    a, b = imread(editor_png), imread(script_dir / "script.png")
    assert a.shape == b.shape
    assert np.abs(a - b).max() == 0


def test_script_is_valid_python_for_all_layer_kinds(workdir):
    spec = hw.load(workdir / "datamc.yaml")
    spec.pad("ratio").layers.append(
        hw.spec.models.PullLayer(id="p", kind="pull", num="data", den="bkg", visible=False)
    )
    compile(generate(spec, workdir).source(), "<generated>", "exec")


def test_hidden_layer_still_computed(workdir):
    """A hidden histogram can still feed a ratio."""
    spec = hw.load(workdir / "datamc.yaml")
    spec.layer("data").visible = False
    result = hw.render(spec, workdir)
    assert result.warnings == []
    assert "pads.main.layers.data" not in result.tagger.tagged
    assert "pads.ratio.layers.r" in result.tagger.tagged


@pytest.mark.parametrize("value, expected", [
    ("a", "'a'"),
    (r"$t\bar{t}$", r"r'$t\bar{t}$'"),
    ("it's", '"it\'s"'),
    ((1, 2), "(1, 2)"),
    ([("f", "p")], "[('f', 'p')]"),
])
def test_lit(value, expected):
    assert lit(value) == expected
