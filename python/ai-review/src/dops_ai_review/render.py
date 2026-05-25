"""Terminal output for reviews."""

from rich.console import Console
from rich.table import Table

from dops_ai_review.analysis import IssueAnalysis
from dops_ai_review.jira import IssueDetails
from dops_ai_review.models import Review

SEVERITY_STYLE = {"critical": "bold red", "major": "red", "minor": "yellow", "info": "dim"}
VERDICT_STYLE = {"approve": "green", "comment": "yellow", "request_changes": "bold red"}
SEVERITY_ORDER = ["critical", "major", "minor", "info"]


def print_review(review: Review, console: Console) -> None:
    style = VERDICT_STYLE[review.verdict]
    console.print(f"[{style}]{review.verdict.replace('_', ' ')}[/] {review.summary}")
    if not review.findings:
        return
    table = Table(show_header=True, header_style="bold", box=None, pad_edge=False)
    table.add_column("severity")
    table.add_column("where", overflow="fold")
    table.add_column("finding", overflow="fold")
    for finding in sorted(review.findings, key=lambda f: SEVERITY_ORDER.index(f.severity)):
        where = finding.file + (f":{finding.line}" if finding.line else "")
        table.add_row(
            f"[{SEVERITY_STYLE[finding.severity]}]{finding.severity}[/]", where, finding.message
        )
    console.print()
    console.print(table)


def print_issue(details: IssueDetails, analysis: IssueAnalysis | None, console: Console) -> None:
    issue = details.issue
    meta = " · ".join(
        part
        for part in (issue.issue_type, issue.status, issue.priority, issue.assignee or "unassigned")
        if part
    )
    console.print(f"[bold]{issue.key}[/] {issue.summary}")
    console.print(f"[dim]{meta} · {details.url}[/]")
    if issue.description:
        console.print()
        console.print(issue.description)
    if details.related:
        console.print()
        console.print("[bold]Related[/]")
        for other in details.related:
            console.print(f"  {other.key} [dim]{other.status}[/] {other.summary}")
    if details.comments:
        console.print()
        console.print(f"[bold]Comments[/] ({len(details.comments)})")
        for comment in details.comments[-5:]:
            console.print(f"  [dim]{comment.author}:[/] {comment.body[:300]}")
    if analysis:
        console.print()
        console.print(f"[bold]Analysis[/] {analysis.summary}")
        sections = [
            ("Acceptance criteria", analysis.acceptance_criteria),
            ("Technical notes", analysis.technical_notes),
            ("Risks", analysis.risks),
            ("Questions", analysis.questions),
            ("Suggested steps", analysis.suggested_steps),
        ]
        for title, items in sections:
            if items:
                console.print(f"  [bold]{title}[/]")
                for item in items:
                    console.print(f"    - {item}")
