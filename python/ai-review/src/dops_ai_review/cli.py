"""Command line entry point: ``dops-ai``."""

from typing import Annotated

import typer

from dops_ai_review import __version__

app = typer.Typer(help="AI review of git diffs and commits.", no_args_is_help=True)


def _version(value: bool) -> None:
    if value:
        typer.echo(__version__)
        raise typer.Exit()


@app.callback()
def main(
    version: Annotated[
        bool, typer.Option("--version", callback=_version, is_eager=True, help="Show version.")
    ] = False,
) -> None:
    """AI review of git diffs and commits."""
