"""Reviewing a diff with a provider."""

from dops_ai_review.git import Diff
from dops_ai_review.models import Review
from dops_ai_review.prompts import SYSTEM, build_prompt
from dops_ai_review.providers import Provider


def review_diff(diff: Diff, provider: Provider, context: str | None = None) -> Review:
    if diff.empty:
        return Review(summary="Nothing to review: the diff is empty.", verdict="approve")
    return provider.review(SYSTEM, build_prompt(diff, context))
