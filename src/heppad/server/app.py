"""HTTP API for the browser editor.

The server is stateless: the browser holds the spec being edited and sends it
with every render/export/save request. ``base_dir`` is the directory relative
input paths resolve against (the spec's directory once it has been saved).
"""

from __future__ import annotations

import os
import posixpath
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

import numpy as np
from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, ValidationError

from ..codegen.generate import generate
from ..data import root
from ..render.figure import effective_layout, render
from ..spec import io as spec_io
from ..spec.models import PlotSpec

STATIC = Path(__file__).parent / "static"
SPEC_SUFFIXES = (".yaml", ".yml")


class SpecRequest(BaseModel):
    spec: dict[str, Any]
    base_dir: str


class ExportRequest(SpecRequest):
    format: Literal["pdf", "png", "svg", "py", "yaml"]
    name: str = "plot"


class SaveRequest(SpecRequest):
    path: str
    # Also write a script and images next to the spec (inputs relative to it).
    script: bool = False
    images: list[Literal["pdf", "png", "svg"]] = []


def create_app(start_dir: Path, open_path: Path | None = None) -> FastAPI:
    app = FastAPI(title="hep-pad")
    start_dir = start_dir.resolve()

    @app.get("/api/session")
    def session():
        initial = None
        if open_path is not None and open_path.suffix in SPEC_SUFFIXES:
            initial = _load_spec(open_path)
        return {
            "start_dir": str(start_dir),
            "open_root": str(open_path.resolve()) if open_path and open_path.suffix == ".root" else None,
            "initial": initial,
            "styles": ["CMS", "ATLAS", "LHCb2", "ALICE", "ROOT"],
        }

    @app.get("/api/defaults")
    def defaults(style: str = "CMS"):
        try:
            spec = PlotSpec(style=style)
        except ValidationError as exc:
            raise HTTPException(422, _errors(exc)) from None
        return effective_layout(spec)

    @app.get("/api/fs")
    def list_dir(dir: str | None = None):
        if dir and root.is_url(dir):
            return _list_remote(dir)
        d = Path(dir).expanduser().resolve() if dir else start_dir
        if not d.is_dir():
            raise HTTPException(404, f"not a directory: {d}")
        entries = []
        try:
            children = sorted(d.iterdir(), key=lambda p: (not p.is_dir(), p.name.lower()))
        except PermissionError:
            raise HTTPException(403, f"permission denied: {d}") from None
        for p in children:
            if p.name.startswith("."):
                continue
            if p.is_dir():
                kind = "dir"
            elif p.suffix == ".root":
                kind = "root"
            elif p.suffix in SPEC_SUFFIXES:
                kind = "spec"
            else:
                continue
            entries.append({"name": p.name, "path": str(p), "kind": kind})
        return {"dir": str(d), "parent": str(d.parent) if d.parent != d else None, "entries": entries}

    @app.get("/api/root")
    def root_objects(file: str):
        try:
            objects = root.list_objects(file)
        except FileNotFoundError:
            raise HTTPException(404, f"no such file: {file}") from None
        except Exception as exc:
            raise HTTPException(422, f"cannot read {file}: {exc}") from None
        return {"objects": [{"path": o.path, "classname": o.classname, "kind": o.kind}
                            for o in objects]}

    @app.get("/api/root/preview")
    def root_preview(file: str, path: str):
        try:
            obj = root.cached_read(file, path)
        except Exception as exc:
            raise HTTPException(422, str(exc)) from None
        if obj["kind"] == "h1":
            values = obj["values"][1:-1]
            return {"kind": "h1", "nbins": len(values),
                    "xmin": float(obj["edges"][0]), "xmax": float(obj["edges"][-1]),
                    "integral": float(values.sum()), "values": _downsample(values)}
        if obj["kind"] == "h2":
            values = obj["values"][1:-1, 1:-1]
            return {"kind": "h2", "nbins": list(values.shape),
                    "xmin": float(obj["xedges"][0]), "xmax": float(obj["xedges"][-1]),
                    "ymin": float(obj["yedges"][0]), "ymax": float(obj["yedges"][-1]),
                    "integral": float(values.sum())}
        return {"kind": "graph", "npoints": len(obj["x"]),
                "xmin": float(np.min(obj["x"])) if len(obj["x"]) else 0,
                "xmax": float(np.max(obj["x"])) if len(obj["x"]) else 0,
                "values": [float(v) for v in obj["y"][:100]]}

    @app.get("/api/root/branches")
    def tree_branches(file: str, path: str):
        try:
            return {"branches": root.tree_branches(file, path)}
        except Exception as exc:
            raise HTTPException(422, f"cannot read {path} in {file}: {_message(exc)}") from None

    @app.get("/api/root/tree/preview")
    def tree_preview(file: str, path: str, expr: str, cut: str | None = None):
        try:
            return root.tree_preview(file, path, expr, cut or None)
        except Exception as exc:
            raise HTTPException(422, _message(exc)) from None

    @app.post("/api/render")
    def render_spec(req: SpecRequest):
        spec = _validate(req.spec)
        result = render(spec, req.base_dir)
        svg = result.to_bytes("svg").decode()
        return {
            "svg": svg[svg.index("<svg"):],  # drop the XML prolog for inline use
            **result.elements(),
            "warnings": result.warnings,
            "systematics": result.systematics,
            "layout": effective_layout(spec),
        }

    @app.post("/api/export")
    def export(req: ExportRequest):
        spec = _validate(req.spec)
        name = Path(req.name).stem or "plot"
        if req.format == "yaml":
            content, media = spec_io.dumps(spec).encode(), "application/yaml"
        elif req.format == "py":
            # Absolute input paths: a downloaded script cannot know where it will live.
            program = generate(spec, req.base_dir, output=f"{name}.pdf")
            content, media = program.source().encode(), "text/x-python"
        else:
            content = render(spec, req.base_dir).to_bytes(req.format)
            media = {"pdf": "application/pdf", "png": "image/png", "svg": "image/svg+xml"}[req.format]
        return Response(content, media_type=media, headers={
            "Content-Disposition": f'attachment; filename="{name}.{req.format}"'})

    @app.get("/api/spec")
    def load_spec(path: str):
        return _load_spec(Path(path))

    @app.post("/api/spec/save")
    def save_spec(req: SaveRequest):
        path = Path(req.path).expanduser().resolve()
        if path.suffix not in SPEC_SUFFIXES:
            path = path.with_suffix(".yaml")
        spec = _validate(req.spec)
        # Store input paths relative to the spec so the folder can be moved as a whole.
        base = Path(req.base_dir)
        spec.inputs = {k: v if root.is_url(v) else _relative(base / v, path.parent)
                       for k, v in spec.inputs.items()}
        path.parent.mkdir(parents=True, exist_ok=True)
        spec_io.save(spec, path)
        written = [str(path)]
        if req.script:
            script = path.with_suffix(".py")
            program = generate(spec, path.parent, script_dir=path.parent,
                               output=f"{path.stem}.pdf", source_name=path.name)
            script.write_text(program.source())
            written.append(str(script))
        if req.images:
            result = render(spec, path.parent)
            for fmt in req.images:
                target = path.with_suffix(f".{fmt}")
                result.save(target)
                written.append(str(target))
        return {"path": str(path), "base_dir": str(path.parent),
                "spec": spec.model_dump(mode="json"), "written": written}

    if STATIC.is_dir():
        app.mount("/assets", StaticFiles(directory=STATIC / "assets"), name="assets")

        @app.get("/", include_in_schema=False)
        def index():
            return FileResponse(STATIC / "index.html")
    else:
        @app.get("/", include_in_schema=False)
        def index_missing():
            return HTMLResponse(
                "<h1>hep-pad</h1><p>The frontend is not built. Run "
                "<code>npm install && npm run build</code> in <code>frontend/</code>.</p>"
            )

    return app


def _validate(data: dict) -> PlotSpec:
    try:
        return spec_io.from_dict(data)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, _errors(exc)) from None


def _errors(exc: Exception) -> list[str]:
    if isinstance(exc, ValidationError):
        out = []
        for e in exc.errors():
            msg = e["msg"].removeprefix("Value error, ")
            loc = ".".join(str(p) for p in e["loc"])
            out.append(f"{loc}: {msg}" if loc else msg)
        return out
    return [str(exc)]


def _load_spec(path: Path) -> dict:
    path = path.expanduser().resolve()
    try:
        spec = spec_io.load(path)
    except FileNotFoundError:
        raise HTTPException(404, f"no such file: {path}") from None
    except (ValidationError, ValueError) as exc:
        raise HTTPException(422, _errors(exc)) from None
    return {"path": str(path), "base_dir": str(path.parent), "spec": spec.model_dump(mode="json")}


def _list_remote(url: str) -> dict:
    """Directory listing of a URL through fsspec: folders and ROOT files only."""
    import fsspec

    try:
        fs, path = fsspec.core.url_to_fs(url)
        infos = fs.ls(path, detail=True)
    except ImportError as exc:
        raise HTTPException(422, f"{exc} (install hep-pad[remote])") from None
    except FileNotFoundError:
        raise HTTPException(404, f"not a directory: {url}") from None
    except Exception as exc:
        raise HTTPException(422, f"cannot list {url}: {exc}") from None
    scheme, netloc, dir_path, _, _ = urlsplit(url)

    def to_url(name: str) -> str:
        if "://" in name:
            return name
        full = fs.unstrip_protocol(name)
        # Some filesystems (sftp) drop the host from the paths they return.
        return full if netloc in full else urlunsplit((scheme, netloc, name, "", ""))

    entries = []
    for info in infos:
        name = posixpath.basename(info["name"].rstrip("/"))
        if not name or name.startswith("."):
            continue
        if info.get("type") == "directory":
            kind = "dir"
        elif name.endswith(".root"):
            kind = "root"
        else:
            continue
        entries.append({"name": name, "path": to_url(info["name"]), "kind": kind})
    entries.sort(key=lambda e: (e["kind"] != "dir", e["name"].lower()))
    parent = posixpath.dirname(dir_path.rstrip("/"))
    parent_url = urlunsplit((scheme, netloc, parent + "/" if scheme.startswith("http") else parent, "", ""))
    return {"dir": url, "parent": parent_url if parent and parent != dir_path.rstrip("/") else None,
            "entries": entries}


def _message(exc: Exception) -> str:
    # str(KeyError) quotes its message; uproot's KeyInFileError formats a full one.
    return str(exc.args[0]) if type(exc) is KeyError and exc.args else str(exc)


def _relative(target: Path, start: Path) -> str:
    target = target.resolve()
    try:
        return os.path.relpath(target, start)
    except ValueError:  # different drive on Windows
        return str(target)


def _downsample(values: np.ndarray, n: int = 100) -> list[float]:
    if len(values) <= n:
        return [float(v) for v in values]
    chunks = np.array_split(values, n)
    return [float(c.sum()) for c in chunks]
