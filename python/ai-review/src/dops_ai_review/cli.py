"""Command line entry point: ``dops-ai``."""

import os
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from dops_ai_review import __version__
from dops_ai_review.git import GitError, collect_diff
from dops_ai_review.providers import ProviderError, get_provider
from dops_ai_review.render import print_review
from dops_ai_review.review import review_diff

app = typer.Typer(help="AI review of git diffs and commits.", no_args_is_help=True)
console = Console()
errors = Console(stderr=True)


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


@app.command()
def review(
    diff: Annotated[
        str | None, typer.Option("--diff", "-d", help="Revision or range, e.g. HEAD~1 or main...")
    ] = None,
    staged: Annotated[bool, typer.Option(help="Review staged changes only.")] = False,
    provider: Annotated[str, typer.Option("--provider", "-p", help="Model provider.")] = "openai",
    model: Annotated[str | None, typer.Option(help="Override the provider's model.")] = None,
    context_file: Annotated[
        Path | None, typer.Option("--context", exists=True, help="Extra context, e.g. a ticket.")
    ] = None,
    as_json: Annotated[bool, typer.Option("--json", help="Print the review as JSON.")] = False,
    strict: Annotated[
        bool, typer.Option(help="Exit with 1 when the verdict is request_changes.")
    ] = True,
) -> None:
    """Review a diff (working tree by default)."""
    try:
        changes = collect_diff(diff, staged=staged)
        context = context_file.read_text() if context_file else None
        with console.status(f"Reviewing {len(changes.files)} files…", spinner="dots"):
            result = review_diff(changes, get_provider(provider, os.environ, model), context)
    except (GitError, ProviderError) as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error

    if as_json:
        typer.echo(result.model_dump_json(indent=2))
    else:
        if changes.omitted:
            console.print(f"[dim]Skipped (too large): {', '.join(changes.omitted)}[/]")
        print_review(result, console)
    if strict and result.verdict == "request_changes":
        raise typer.Exit(1)
