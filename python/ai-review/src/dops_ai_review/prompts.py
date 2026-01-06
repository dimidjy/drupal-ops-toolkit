"""Prompts shared by all providers."""

from dops_ai_review.git import Diff

SYSTEM = """\
You are a senior Drupal and PHP/JavaScript developer reviewing a colleague's change.
Look for bugs, security problems (access checks, XSS, SQL injection, secrets in code),
Drupal API misuse (caching metadata, dependency injection, config vs state, update hooks),
performance issues and missing tests. Ignore formatting that a linter would catch.
Only report problems you can point to in the diff. Be brief and concrete; no praise.
Use "request_changes" only for bugs or security problems, "comment" for anything else
worth mentioning and "approve" when there is nothing to report."""


def build_prompt(diff: Diff, context: str | None = None) -> str:
    parts = []
    if context:
        parts.append(f"<context>\n{context.strip()}\n</context>")
    if diff.omitted:
        omitted = ", ".join(diff.omitted)
        parts.append(f"These changed files were left out because of size: {omitted}")
    parts.append(f"<diff>\n{diff.text}</diff>")
    return "\n\n".join(parts)
