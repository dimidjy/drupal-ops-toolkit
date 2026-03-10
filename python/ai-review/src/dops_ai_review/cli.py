"""Command line entry point: ``dops-ai``."""

import os
from collections.abc import Sequence
from pathlib import Path
from typing import Annotated

import typer
from rich.console import Console

from dops_ai_review import __version__
from dops_ai_review.board import print_board, print_summary, summarize_board
from dops_ai_review.git import Diff, GitError, collect_diff, commit_message
from dops_ai_review.hooks import HookError, install_hook, uninstall_hook
from dops_ai_review.jira import JiraClient, JiraError, JiraIssue, issue_keys
from dops_ai_review.providers import ProviderError, get_provider
from dops_ai_review.render import print_review
from dops_ai_review.review import review_diff

app = typer.Typer(help="AI review of git diffs and commits.", no_args_is_help=True)
console = Console()
errors = Console(stderr=True)

ProviderOption = Annotated[str, typer.Option("--provider", "-p", help="Model provider.")]
ModelOption = Annotated[str | None, typer.Option(help="Override the provider's model.")]
JsonOption = Annotated[bool, typer.Option("--json", help="Print the review as JSON.")]
StrictOption = Annotated[
    bool, typer.Option(help="Exit with 1 when the verdict is request_changes.")
]


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


def fetch_tickets(keys: Sequence[str]) -> list[JiraIssue]:
    """Loads the given issues; Jira problems are reported but never fatal."""
    if not keys:
        return []
    try:
        jira = JiraClient.from_env(os.environ)
    except JiraError as error:
        errors.print(f"[yellow]warning:[/] {error}; reviewing without tickets")
        return []
    tickets = []
    for key in keys:
        try:
            tickets.append(jira.get_issue(key))
        except JiraError as error:
            errors.print(f"[yellow]warning:[/] {error}")
    return tickets


def _review(
    changes: Diff,
    *,
    provider: str,
    model: str | None,
    as_json: bool,
    strict: bool,
    context: str | None = None,
    tickets: Sequence[JiraIssue] = (),
    message: str | None = None,
) -> None:
    try:
        with console.status(f"Reviewing {len(changes.files)} files…", spinner="dots"):
            result = review_diff(
                changes,
                get_provider(provider, os.environ, model),
                context,
                tickets=tickets,
                commit_message=message,
            )
    except ProviderError as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error

    if as_json:
        typer.echo(result.model_dump_json(indent=2))
    else:
        if tickets:
            console.print(f"[dim]Tickets: {', '.join(t.key for t in tickets)}[/]")
        if changes.omitted:
            console.print(f"[dim]Skipped (too large): {', '.join(changes.omitted)}[/]")
        print_review(result, console)
    if strict and result.verdict == "request_changes":
        raise typer.Exit(1)


@app.command()
def review(
    diff: Annotated[
        str | None, typer.Option("--diff", "-d", help="Revision or range, e.g. HEAD~1 or main...")
    ] = None,
    staged: Annotated[bool, typer.Option(help="Review staged changes only.")] = False,
    context_file: Annotated[
        Path | None, typer.Option("--context", exists=True, help="Extra context, e.g. a ticket.")
    ] = None,
    provider: ProviderOption = "openai",
    model: ModelOption = None,
    as_json: JsonOption = False,
    strict: StrictOption = True,
) -> None:
    """Review a diff (working tree by default)."""
    try:
        changes = collect_diff(diff, staged=staged)
    except GitError as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error
    context = context_file.read_text() if context_file else None
    _review(
        changes, provider=provider, model=model, as_json=as_json, strict=strict, context=context
    )


@app.command()
def commit(
    rev: Annotated[str, typer.Argument(help="Commit to review.")] = "HEAD",
    jira: Annotated[bool, typer.Option(help="Load Jira tickets named in the message.")] = True,
    provider: ProviderOption = "openai",
    model: ModelOption = None,
    as_json: JsonOption = False,
    strict: StrictOption = True,
) -> None:
    """Review one commit against the Jira tickets in its message."""
    try:
        message = commit_message(rev)
        changes = collect_diff(f"{rev}^!")
    except GitError as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error
    tickets = fetch_tickets(issue_keys(message)) if jira else []
    _review(
        changes,
        provider=provider,
        model=model,
        as_json=as_json,
        strict=strict,
        tickets=tickets,
        message=message,
    )


hook_app = typer.Typer(help="Run the review automatically before git push.")
app.add_typer(hook_app, name="hook")


@hook_app.command("install")
def hook_install(
    provider: ProviderOption = "openai",
    force: Annotated[bool, typer.Option(help="Replace an existing pre-push hook.")] = False,
) -> None:
    """Install a pre-push hook that reviews the commits being pushed."""
    try:
        path = install_hook(provider, force=force)
    except (GitError, HookError) as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error
    console.print(f"Installed {path}")


@hook_app.command("uninstall")
def hook_uninstall() -> None:
    """Remove the pre-push hook installed by dops-ai."""
    try:
        path = uninstall_hook()
    except (GitError, HookError) as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error
    console.print(f"Removed {path}" if path else "No pre-push hook installed")


@app.command()
def board(
    jql: Annotated[
        str | None,
        typer.Option(help="Issues to show; defaults to DOPS_JIRA_JQL."),
    ] = None,
    limit: Annotated[int, typer.Option(help="Maximum number of issues.")] = 100,
    summarize: Annotated[bool, typer.Option(help="Add an AI summary with risks.")] = False,
    provider: ProviderOption = "openai",
    model: ModelOption = None,
) -> None:
    """Show a Jira board grouped by status, optionally with an AI summary."""
    query = jql or os.environ.get("DOPS_JIRA_JQL")
    if not query:
        errors.print("[red]error:[/] pass --jql or set DOPS_JIRA_JQL")
        raise typer.Exit(2)
    try:
        issues = JiraClient.from_env(os.environ).search(query, limit)
        print_board(issues, console)
        if summarize and issues:
            with console.status("Summarising…", spinner="dots"):
                summary = summarize_board(issues, get_provider(provider, os.environ, model))
            print_summary(summary, console)
    except (JiraError, ProviderError) as error:
        errors.print(f"[red]error:[/] {error}")
        raise typer.Exit(2) from error
    if not issues:
        console.print("No issues match the query.")
