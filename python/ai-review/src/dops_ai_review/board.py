"""Sprint / board overview from a JQL query, optionally summarised by a model."""

from collections.abc import Sequence
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field
from rich.console import Console
from rich.table import Table

from dops_ai_review.jira import JiraIssue
from dops_ai_review.providers import Provider


class BoardSummary(BaseModel):
    summary: str
    risks: list[str] = Field(default_factory=list)
    blocked: list[str] = Field(default_factory=list)


BOARD_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "risks", "blocked"],
    "properties": {
        "summary": {"type": "string", "description": "Three or four sentences on progress."},
        "risks": {"type": "array", "items": {"type": "string"}},
        "blocked": {
            "type": "array",
            "items": {"type": "string"},
            "description": "Keys of issues that look blocked or stalled.",
        },
    },
}

BOARD_SYSTEM = """\
You are helping a developer prepare for a stand-up. Given the issues on a Jira board,
summarise where the work stands, name concrete risks (unassigned high-priority work,
too much in progress, bugs piling up) and list issues that look blocked. Be factual
and brief, and only refer to issues that are in the list."""


# Statuses where an untouched issue is worth a second look.
ACTIVE_HINTS = ("progress", "review", "test", "qa")
STALE_DAYS = 5


def is_stale(issue: JiraIssue, now: datetime | None = None) -> bool:
    idle = issue.idle_days(now)
    active = any(hint in issue.status.lower() for hint in ACTIVE_HINTS)
    return active and idle is not None and idle >= STALE_DAYS


def group_by_status(issues: Sequence[JiraIssue]) -> dict[str, list[JiraIssue]]:
    groups: dict[str, list[JiraIssue]] = {}
    for issue in issues:
        groups.setdefault(issue.status, []).append(issue)
    return groups


def board_prompt(issues: Sequence[JiraIssue]) -> str:
    lines = []
    for status, group in group_by_status(issues).items():
        lines.append(f"## {status} ({len(group)})")
        for issue in group:
            meta = ", ".join(
                part
                for part in (issue.issue_type, issue.priority, issue.assignee or "unassigned")
                if part
            )
            idle = issue.idle_days()
            updated = f" (no update for {idle} days)" if idle else ""
            lines.append(f"- {issue.key} [{meta}] {issue.summary}{updated}")
    return "\n".join(lines)


def summarize_board(issues: Sequence[JiraIssue], provider: Provider) -> BoardSummary:
    return provider.generate(BOARD_SYSTEM, board_prompt(issues), BoardSummary, BOARD_SCHEMA)


def print_board(issues: Sequence[JiraIssue], console: Console) -> None:
    for status, group in group_by_status(issues).items():
        table = Table(title=f"{status} ({len(group)})", title_justify="left", box=None)
        table.add_column("key", style="bold", no_wrap=True)
        table.add_column("type")
        table.add_column("priority")
        table.add_column("assignee")
        table.add_column("idle", justify="right")
        table.add_column("summary", overflow="fold")
        for issue in group:
            table.add_row(
                issue.key,
                issue.issue_type,
                issue.priority or "",
                issue.assignee or "[dim]unassigned[/]",
                _idle(issue),
                issue.summary,
            )
        console.print(table)
        console.print()


def _idle(issue: JiraIssue) -> str:
    idle = issue.idle_days()
    if idle is None:
        return ""
    return f"[red]{idle}d[/]" if is_stale(issue) else f"[dim]{idle}d[/]"


def print_summary(summary: BoardSummary, console: Console) -> None:
    console.print(f"[bold]Summary[/] {summary.summary}")
    for risk in summary.risks:
        console.print(f"  [yellow]risk[/] {risk}")
    if summary.blocked:
        console.print(f"  [red]blocked[/] {', '.join(summary.blocked)}")
