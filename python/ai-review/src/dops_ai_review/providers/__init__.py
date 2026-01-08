from collections.abc import Mapping

from dops_ai_review.providers.base import Provider, ProviderError
from dops_ai_review.providers.openai import OpenAIProvider

PROVIDERS = ("openai",)


def get_provider(name: str, env: Mapping[str, str], model: str | None = None) -> Provider:
    if name == "openai":
        return OpenAIProvider.from_env(env, model)
    raise ProviderError(f"Unknown provider {name!r}, expected one of: {', '.join(PROVIDERS)}")


__all__ = ["PROVIDERS", "OpenAIProvider", "Provider", "ProviderError", "get_provider"]
