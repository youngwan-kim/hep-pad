import pytest
from fastapi.testclient import TestClient

from heppad.server.app import create_app
from heppad.spec import io


@pytest.fixture
def client(workdir):
    return TestClient(create_app(workdir, workdir / "datamc.yaml"))


@pytest.fixture
def datamc(workdir):
    return io.load(workdir / "datamc.yaml").model_dump(mode="json")


def test_session_opens_initial_spec(client, workdir):
    s = client.get("/api/session").json()
    assert s["start_dir"] == str(workdir.resolve())
    assert s["initial"]["spec"]["pads"][0]["id"] == "main"


def test_fs_lists_root_and_specs(client, workdir):
    entries = client.get("/api/fs", params={"dir": str(workdir)}).json()["entries"]
    kinds = {e["name"]: e["kind"] for e in entries}
    assert kinds["sample.root"] == "root" and kinds["datamc.yaml"] == "spec"


def test_root_listing_and_preview(client, workdir):
    f = str(workdir / "sample.root")
    objs = {o["path"]: o["kind"] for o in client.get("/api/root", params={"file": f}).json()["objects"]}
    assert objs["data/h_mass"] == "h1" and objs["mc/dy/h_eta_pt"] == "h2" and objs["eff/g_trig"] == "graph"
    prev = client.get("/api/root/preview", params={"file": f, "path": "data/h_mass"}).json()
    assert prev["nbins"] == 60 and len(prev["values"]) == 60 and prev["integral"] > 0


def test_render(client, workdir, datamc):
    r = client.post("/api/render", json={"spec": datamc, "base_dir": str(workdir)}).json()
    assert r["svg"].startswith("<svg") and 'id="pads.main.legend"' in r["svg"]
    assert "pads.main.layers.data" in r["elements"]
    assert set(r["axes"]) == {"main", "ratio"}
    assert r["warnings"] == []
    assert r["layout"]["hspace"] == pytest.approx(0.07)


def test_render_invalid_spec_is_422(client, workdir, datamc):
    datamc["layout"]["rows"] = 1  # ratio pad now lies outside the grid
    datamc["layout"]["height_ratios"] = None
    r = client.post("/api/render", json={"spec": datamc, "base_dir": str(workdir)})
    assert r.status_code == 422
    assert r.json()["detail"] == ["pad 'ratio' lies outside the 1x1 grid"]


@pytest.mark.parametrize("fmt, magic", [("pdf", b"%PDF"), ("png", b"\x89PNG"), ("py", b'"""Plot'),
                                        ("yaml", b"version: 1"), ("svg", b"<?xml")])
def test_export(client, workdir, datamc, fmt, magic):
    r = client.post("/api/export", json={"spec": datamc, "base_dir": str(workdir), "format": fmt,
                                         "name": "datamc"})
    assert r.status_code == 200 and r.content.startswith(magic)
    assert f'filename="datamc.{fmt}"' in r.headers["content-disposition"]


def test_save_relativizes_inputs_and_writes_script(client, workdir, datamc, tmp_path):
    datamc["inputs"] = {"sample": str(workdir / "sample.root")}  # as the editor stores them
    target = tmp_path / "out" / "plot"
    r = client.post("/api/spec/save", json={"spec": datamc, "base_dir": str(workdir),
                                            "path": str(target), "script": True, "images": ["png"]})
    assert r.status_code == 200, r.text
    saved = io.load(tmp_path / "out" / "plot.yaml")
    assert not saved.inputs["sample"].startswith("/")
    assert (tmp_path / "out" / "plot.py").exists() and (tmp_path / "out" / "plot.png").exists()
    # The saved spec renders from its new location.
    again = client.get("/api/spec", params={"path": str(tmp_path / "out" / "plot.yaml")}).json()
    r = client.post("/api/render", json={"spec": again["spec"], "base_dir": again["base_dir"]}).json()
    assert r["warnings"] == []


def test_defaults_per_style(client):
    d = client.get("/api/defaults", params={"style": "CMS"}).json()
    assert set(d["margins"]) == {"left", "right", "top", "bottom"}
