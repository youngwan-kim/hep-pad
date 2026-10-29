"""Command-line interface: ``hep-pad render``, ``hep-pad ls``."""

from __future__ import annotations

from pathlib import Path

import typer

app = typer.Typer(no_args_is_help=True, add_completion=False)


@app.command()
def render(
    specs: list[Path] = typer.Argument(..., exists=True, dir_okay=False, help="Spec YAML files."),
    output: Path | None = typer.Option(
        None, "-o", "--output",
        help="Output file (single spec) or directory (several specs). Default: next to the spec.",
    ),
    fmt: list[str] = typer.Option(["pdf"], "-f", "--format", help="Output format(s): pdf, png, svg."),
    strict: bool = typer.Option(False, help="Exit non-zero if any layer fails to draw."),
) -> None:
    """Render plot specs to image files."""
    from .render.figure import render as render_spec
    from .spec.io import load

    failed = False
    single_file = output is not None and len(specs) == 1 and output.suffix != ""
    for spec_path in specs:
        spec = load(spec_path)
        result = render_spec(spec, base_dir=spec_path.parent)
        for warning in result.warnings:
            typer.secho(f"{spec_path}: warning: {warning}", fg="yellow", err=True)
            failed = True
        targets = (
            [output]
            if single_file
            else [
                (output or spec_path.parent) / f"{spec_path.stem}.{f}"
                for f in fmt
            ]
        )
        for target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            result.save(target)
            typer.echo(f"{spec_path} -> {target}")
    if strict and failed:
        raise typer.Exit(1)


@app.command()
def codegen(
    spec_path: Path = typer.Argument(..., exists=True, dir_okay=False, help="Spec YAML file."),
    output: Path | None = typer.Option(
        None, "-o", "--output", help="Script path. Default: <spec>.py next to the spec."
    ),
    image: str = typer.Option("pdf", "--image-format", help="Format the script saves to."),
) -> None:
    """Write a standalone Python script that draws the plot."""
    from .codegen.generate import generate
    from .spec.io import load

    output = output or spec_path.with_suffix(".py")
    program = generate(
        load(spec_path),
        base_dir=spec_path.parent,
        script_dir=output.parent,
        output=f"{output.stem}.{image}",
        source_name=spec_path.name,
    )
    output.write_text(program.source())
    typer.echo(f"{spec_path} -> {output}")


@app.command()
def serve(
    path: Path | None = typer.Argument(
        None, help="Directory to browse, a spec (.yaml) to open, or a ROOT file to browse."
    ),
    host: str = typer.Option("127.0.0.1", help="Interface to bind. Keep 127.0.0.1 and use an SSH tunnel for remote machines."),
    port: int = typer.Option(8765),
    browser: bool = typer.Option(True, help="Open a browser tab."),
) -> None:
    """Start the editor."""
    import threading
    import webbrowser

    import uvicorn

    from .server.app import create_app

    path = (path or Path.cwd()).expanduser()
    if not path.exists():
        raise typer.BadParameter(f"{path} does not exist")
    start_dir = path if path.is_dir() else path.parent
    app_ = create_app(start_dir, None if path.is_dir() else path)
    url = f"http://{host}:{port}/"
    typer.echo(f"hep-pad editor: {url}")
    if browser:
        threading.Timer(1.0, webbrowser.open, args=[url]).start()
    uvicorn.run(app_, host=host, port=port, log_level="warning")


@app.command("ls")
def list_objects(
    file: Path = typer.Argument(..., exists=True, dir_okay=False, help="ROOT file."),
) -> None:
    """List plottable objects in a ROOT file."""
    from .data.root import list_objects as _list

    for obj in _list(file):
        if obj.kind != "dir":
            typer.echo(f"{obj.kind:6} {obj.classname:22} {obj.path}")


if __name__ == "__main__":
    app()
