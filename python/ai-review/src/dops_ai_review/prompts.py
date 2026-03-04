"""Prompts shared by all providers."""

from collections.abc import Sequence

from dops_ai_review.git import Diff
from dops_ai_review.jira import JiraIssue

SYSTEM = """\
You are a senior Drupal and PHP/JavaScript developer reviewing a colleague's change.
Look for bugs, security problems (access checks, XSS, SQL injection, secrets in code),
Drupal API misuse (caching metadata, dependency injection, config vs state, update hooks),
performance issues and missing tests. Ignore formatting that a linter would catch.
Only report problems you can point to in the diff. Be brief and concrete; no praise.
Use "request_changes" only for bugs or security problems, "comment" for anything else
worth mentioning and "approve" when there is nothing to report."""

TICKET_GUIDANCE = """
The change belongs to the Jira tickets given in <tickets>. Also check that it does what
they ask: report requirements that are missing or implemented differently as findings
with file "(ticket)" and severity "major", and say in the summary how well the change
covers the tickets."""


def system_prompt(has_tickets: bool = False) -> str:
    return SYSTEM + TICKET_GUIDANCE if has_tickets else SYSTEM


def build_prompt(
    diff: Diff,
    context: str | None = None,
    *,
    tickets: Sequence[JiraIssue] = (),
    commit_message: str | None = None,
) -> str:
    parts = []
    if tickets:
        text = "\n\n".join(ticket.as_context() for ticket in tickets)
        parts.append(f"<tickets>\n{text}\n</tickets>")
    if commit_message:
        parts.append(f"<commit_message>\n{commit_message.strip()}\n</commit_message>")
    if context:
        parts.append(f"<context>\n{context.strip()}\n</context>")
    if diff.omitted:
        omitted = ", ".join(diff.omitted)
        parts.append(f"These changed files were left out because of size: {omitted}")
    parts.append(f"<diff>\n{diff.text}</diff>")
    return "\n\n".join(parts)
