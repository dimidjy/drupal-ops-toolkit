"""Sprint / board overview from a JQL query, optionally summarised by a model."""

from collections.abc import Sequence
from datetime import UTC, datetime
from typing import Any, Literal

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


GroupBy = Literal["status", "assignee"]


def group_issues(issues: Sequence[JiraIssue], by: GroupBy = "status") -> dict[str, list[JiraIssue]]:
    """Groups issues by status or assignee, keeping the order Jira returned."""
    groups: dict[str, list[JiraIssue]] = {}
    for issue in issues:
        key = issue.status if by == "status" else issue.assignee or "Unassigned"
        groups.setdefault(key, []).append(issue)
    return groups


def board_prompt(issues: Sequence[JiraIssue]) -> str:
    lines = []
    for status, group in group_issues(issues).items():
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


def print_board(issues: Sequence[JiraIssue], console: Console, by: GroupBy = "status") -> None:
    other: GroupBy = "assignee" if by == "status" else "status"
    for name, group in group_issues(issues, by).items():
        table = Table(title=f"{name} ({len(group)})", title_justify="left", box=None)
        table.add_column("key", style="bold", no_wrap=True)
        table.add_column("type")
        table.add_column("priority")
        table.add_column(other)
        table.add_column("idle", justify="right")
        table.add_column("summary", overflow="fold")
        for issue in group:
            table.add_row(
                issue.key,
                issue.issue_type,
                issue.priority or "",
                (issue.assignee or "[dim]unassigned[/]") if other == "assignee" else issue.status,
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


class BoardReport(BaseModel):
    """Machine-readable output of ``dops-ai board --json``."""

    jql: str
    generated_at: datetime
    counts: dict[str, int]
    stale: list[str]
    issues: list[JiraIssue]
    summary: BoardSummary | None = None


def build_report(
    jql: str,
    issues: Sequence[JiraIssue],
    summary: BoardSummary | None = None,
    now: datetime | None = None,
) -> BoardReport:
    now = now or datetime.now(UTC)
    return BoardReport(
        jql=jql,
        generated_at=now,
        counts={status: len(group) for status, group in group_issues(issues).items()},
        stale=[issue.key for issue in issues if is_stale(issue, now)],
        issues=list(issues),
        summary=summary,
    )


def print_summary(summary: BoardSummary, console: Console) -> None:
    console.print(f"[bold]Summary[/] {summary.summary}")
    for risk in summary.risks:
        console.print(f"  [yellow]risk[/] {risk}")
    if summary.blocked:
        console.print(f"  [red]blocked[/] {', '.join(summary.blocked)}")
