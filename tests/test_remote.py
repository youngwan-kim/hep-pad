"""Inputs given as URLs, served here over HTTP (the same code path as ssh:// and root://)."""

import functools
import http.server
import os
import subprocess
import sys
import threading

import numpy as np
import pytest
from fastapi.testclient import TestClient
from matplotlib.image import imread

import heppad as hw
from heppad.codegen.generate import generate
from heppad.data import root
from heppad.server.app import create_app
from heppad.spec import io

pytest.importorskip("aiohttp", reason="needs hep-pad[remote]")


class _RangeHandler(http.server.SimpleHTTPRequestHandler):
    """Static files with single byte-range requests, which uproot relies on."""

    def do_GET(self):
        spec = self.headers.get("Range", "")
        path = self.translate_path(self.path)
        if not spec.startswith("bytes=") or "," in spec or not os.path.isfile(path):
            return super().do_GET()
        with open(path, "rb") as f:
            data = f.read()
        start, _, stop = spec.removeprefix("bytes=").partition("-")
        start, stop = int(start), min(int(stop or len(data) - 1), len(data) - 1)
        self.send_response(206)
        self.send_header("Content-Range", f"bytes {start}-{stop}/{len(data)}")
        self.send_header("Content-Length", str(stop - start + 1))
        self.end_headers()
        self.wfile.write(data[start:stop + 1])

    def log_message(self, *args):
        pass


@pytest.fixture(scope="module")
def base_url(workdir):
    handler = functools.partial(_RangeHandler, directory=str(workdir))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    yield f"http://127.0.0.1:{server.server_address[1]}/"
    server.shutdown()


@pytest.fixture
def remote_spec(workdir, base_url):
    spec = hw.load(workdir / "datamc.yaml")
    spec.inputs = {"sample": base_url + "sample.root"}
    return spec


def test_is_url():
    assert root.is_url("ssh://me@host:2222/data/a.root")
    assert root.is_url("root://eos.cern.ch//eos/a.root")
    assert not root.is_url("/data/a.root") and not root.is_url("a.root")


def test_cached_read_over_url(workdir, base_url):
    remote = root.cached_read(base_url + "sample.root", "data/h_mass")
    local = root.cached_read(workdir / "sample.root", "data/h_mass")
    assert np.array_equal(remote["values"], local["values"])


def test_render_matches_local(workdir, tmp_path, remote_spec):
    hw.render(hw.load(workdir / "datamc.yaml"), workdir).save(tmp_path / "local.png")
    result = hw.render(remote_spec, base_dir=tmp_path)  # base_dir must not be joined onto a URL
    assert result.warnings == []
    result.save(tmp_path / "remote.png")
    assert np.abs(imread(tmp_path / "local.png") - imread(tmp_path / "remote.png")).max() == 0


def test_script_keeps_url(tmp_path, remote_spec):
    program = generate(remote_spec, tmp_path, script_dir=tmp_path, output="script.png")
    assert program.inputs["sample"] == remote_spec.inputs["sample"]
    script = tmp_path / "plot.py"
    script.write_text(program.source())
    run = subprocess.run([sys.executable, "-I", str(script)], capture_output=True, text=True,
                         env={"MPLBACKEND": "Agg", "PATH": ""})
    assert run.returncode == 0, run.stderr
    assert (tmp_path / "script.png").exists()


def test_server_browse_and_save(workdir, base_url, tmp_path, remote_spec):
    client = TestClient(create_app(workdir))
    listing = client.get("/api/fs", params={"dir": base_url}).json()
    assert {"name": "sample.root", "path": base_url + "sample.root", "kind": "root"} in listing["entries"]
    objs = client.get("/api/root", params={"file": base_url + "sample.root"}).json()["objects"]
    assert any(o["path"] == "data/h_mass" for o in objs)

    r = client.post("/api/spec/save", json={"spec": remote_spec.model_dump(mode="json"),
                                            "base_dir": str(workdir), "path": str(tmp_path / "plot")})
    assert r.status_code == 200, r.text
    assert io.load(tmp_path / "plot.yaml").inputs["sample"] == remote_spec.inputs["sample"]


def test_listing_unreachable_url_is_an_error(workdir):
    client = TestClient(create_app(workdir))
    r = client.get("/api/fs", params={"dir": "http://127.0.0.1:1/"})
    assert r.status_code in (404, 422)


def test_tree_ref_over_url(workdir, base_url):
    tree = {"expr": "mass", "bins": [60, 60, 120]}
    remote = root.cached_read(base_url + "sample.root", "Events", tree)
    assert np.array_equal(remote["values"], root.cached_read(workdir / "sample.root", "data/h_mass")["values"])
