"""Claude via the official Anthropic SDK, with structured JSON output."""

from collections.abc import Mapping
from typing import Any, Literal, cast, get_args

import anthropic
from anthropic.types.beta import BetaOutputConfigParam
from pydantic import ValidationError

from dops_ai_review.providers.base import ProviderError, T

DEFAULT_MODEL = "claude-opus-5-5"

Effort = Literal["low", "medium", "high", "xhigh", "max"]


class AnthropicProvider:
    name = "anthropic"

    def __init__(
        self,
        model: str = DEFAULT_MODEL,
        *,
        effort: Effort = "medium",
        client: anthropic.Anthropic | None = None,
    ) -> None:
        self.model = model
        self.effort = effort
        # Credentials come from ANTHROPIC_API_KEY or an `ant auth login` profile.
        self._client = client or anthropic.Anthropic(timeout=300)

    @classmethod
    def from_env(cls, env: Mapping[str, str], model: str | None = None) -> "AnthropicProvider":
        effort = env.get("DOPS_ANTHROPIC_EFFORT") or "medium"
        if effort not in get_args(Effort):
            raise ProviderError(
                f"DOPS_ANTHROPIC_EFFORT must be one of {', '.join(get_args(Effort))}"
            )
        return cls(
            model or env.get("DOPS_ANTHROPIC_MODEL") or DEFAULT_MODEL,
            effort=cast(Effort, effort),
        )

    def generate(self, system: str, prompt: str, output: type[T], schema: dict[str, Any]) -> T:
        output_config: BetaOutputConfigParam = {
            "effort": self.effort,
            "format": {"type": "json_schema", "schema": schema},
        }
        try:
            response = self._client.beta.messages.create(
                model=self.model,
                max_tokens=16000,
                system=system,
                messages=[{"role": "user", "content": prompt}],
                output_config=output_config,
                # A declined request is retried server-side on the recommended model.
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
            )
        except anthropic.AuthenticationError as error:
            raise ProviderError("Anthropic rejected the API key (set ANTHROPIC_API_KEY)") from error
        except anthropic.RateLimitError as error:
            raise ProviderError("Anthropic rate limit reached, try again later") from error
        except anthropic.APIStatusError as error:
            raise ProviderError(f"Anthropic API {error.status_code}: {error.message}") from error
        except anthropic.APIConnectionError as error:
            raise ProviderError(f"Anthropic request failed: {error}") from error

        if response.stop_reason == "refusal":
            raise ProviderError("Model declined the request")
        if response.stop_reason == "max_tokens":
            raise ProviderError("Output was cut off at max_tokens; try a smaller input")
        text = next((block.text for block in response.content if block.type == "text"), "")
        try:
            return output.model_validate_json(text)
        except ValidationError as error:
            raise ProviderError(f"Unexpected {output.__name__} format: {error}") from error
