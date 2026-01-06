"""OpenAI chat completions with strict structured output."""

from collections.abc import Mapping

import httpx
from pydantic import ValidationError

from dops_ai_review.models import REVIEW_SCHEMA, Review
from dops_ai_review.providers.base import ProviderError

DEFAULT_MODEL = "gpt-4.1-mini"


class OpenAIProvider:
    name = "openai"

    def __init__(
        self,
        api_key: str,
        model: str = DEFAULT_MODEL,
        *,
        base_url: str = "https://api.openai.com/v1",
        client: httpx.Client | None = None,
    ) -> None:
        self.model = model
        self._client = client or httpx.Client(
            base_url=base_url,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=httpx.Timeout(120, connect=10),
        )

    @classmethod
    def from_env(cls, env: Mapping[str, str], model: str | None = None) -> "OpenAIProvider":
        api_key = env.get("OPENAI_API_KEY")
        if not api_key:
            raise ProviderError("OPENAI_API_KEY is not set")
        return cls(api_key, model or env.get("DOPS_OPENAI_MODEL") or DEFAULT_MODEL)

    def review(self, system: str, prompt: str) -> Review:
        try:
            response = self._client.post(
                "/chat/completions",
                json={
                    "model": self.model,
                    "temperature": 0.2,
                    "messages": [
                        {"role": "system", "content": system},
                        {"role": "user", "content": prompt},
                    ],
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {"name": "review", "strict": True, "schema": REVIEW_SCHEMA},
                    },
                },
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            raise ProviderError(_error_message(error.response)) from error
        except httpx.HTTPError as error:
            raise ProviderError(f"OpenAI request failed: {error}") from error

        message = response.json()["choices"][0]["message"]
        if message.get("refusal"):
            raise ProviderError(f"Model refused: {message['refusal']}")
        try:
            return Review.model_validate_json(message["content"])
        except ValidationError as error:
            raise ProviderError(f"Unexpected review format: {error}") from error


def _error_message(response: httpx.Response) -> str:
    try:
        detail = response.json()["error"]["message"]
    except (ValueError, KeyError, TypeError):
        detail = response.text[:200]
    return f"OpenAI API {response.status_code}: {detail}"
