"""Terminal output for reviews."""

from rich.console import Console
from rich.table import Table

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
