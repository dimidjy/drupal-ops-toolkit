"""Reviewing a diff with a provider."""

from collections.abc import Sequence

from dops_ai_review.git import Diff
from dops_ai_review.jira import JiraIssue
from dops_ai_review.models import REVIEW_SCHEMA, Review
from dops_ai_review.prompts import build_prompt, system_prompt
from dops_ai_review.providers import Provider


def review_diff(
    diff: Diff,
    provider: Provider,
    context: str | None = None,
    *,
    tickets: Sequence[JiraIssue] = (),
    commit_message: str | None = None,
) -> Review:
    if diff.empty:
        return Review(summary="Nothing to review: the diff is empty.", verdict="approve")
    prompt = build_prompt(diff, context, tickets=tickets, commit_message=commit_message)
    return provider.generate(system_prompt(bool(tickets)), prompt, Review, REVIEW_SCHEMA)
