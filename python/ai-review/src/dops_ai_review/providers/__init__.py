from collections.abc import Mapping

from dops_ai_review.providers.anthropic import AnthropicProvider
from dops_ai_review.providers.base import Provider, ProviderError
from dops_ai_review.providers.openai import OpenAIProvider

PROVIDERS = ("openai", "anthropic")


def get_provider(name: str, env: Mapping[str, str], model: str | None = None) -> Provider:
    if name == "openai":
        return OpenAIProvider.from_env(env, model)
    if name == "anthropic":
        return AnthropicProvider.from_env(env, model)
    raise ProviderError(f"Unknown provider {name!r}, expected one of: {', '.join(PROVIDERS)}")


__all__ = [
    "PROVIDERS",
    "AnthropicProvider",
    "OpenAIProvider",
    "Provider",
    "ProviderError",
    "get_provider",
]
