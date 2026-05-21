"""Markdown report of my recent Jira work, for weekly updates and timesheets."""

from collections.abc import Callable, Sequence

from dops_ai_review.board import group_issues
from dops_ai_review.jira import JiraIssue


def my_work_jql(days: int) -> str:
    return f"assignee = currentUser() AND updated >= -{days}d ORDER BY updated DESC"


def render_markdown(
    issues: Sequence[JiraIssue], browse_url: Callable[[str], str], title: str
) -> str:
    lines = [f"## {title}", ""]
    if not issues:
        lines.append("_No issues updated in this period._")
    for status, group in group_issues(issues).items():
        lines.append(f"### {status}")
        lines += [f"- [{i.key}]({browse_url(i.key)}) {i.summary}" for i in group]
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"
