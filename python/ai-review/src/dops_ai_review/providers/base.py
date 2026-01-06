from typing import Protocol

from dops_ai_review.models import Review


class ProviderError(RuntimeError):
    """The model API failed or returned something unusable."""


class Provider(Protocol):
    name: str
    model: str

    def review(self, system: str, prompt: str) -> Review: ...
