import json
from collections.abc import Callable
from typing import Any

import anthropic
import httpx2
import pytest

from dops_ai_review.models import REVIEW_SCHEMA, Review
from dops_ai_review.providers import AnthropicProvider, ProviderError

REVIEW = {"summary": "Adds a route.", "verdict": "approve", "findings": []}


def message(text: str, stop_reason: str = "end_turn") -> dict[str, Any]:
    return {
        "id": "msg_1",
        "type": "message",
        "role": "assistant",
        "model": "claude-opus-5-5",
        "content": [{"type": "text", "text": text}],
        "stop_reason": stop_reason,
        "stop_sequence": None,
        "usage": {"input_tokens": 10, "output_tokens": 5},
    }


def provider(handler: Callable[[httpx2.Request], httpx2.Response]) -> AnthropicProvider:
    client = anthropic.Anthropic(
        api_key="sk-ant-test",
        max_retries=0,
        http_client=anthropic.DefaultHttpxClient(transport=httpx2.MockTransport(handler)),
    )
    return AnthropicProvider(client=client)


def test_review_requests_structured_output() -> None:
    requests: list[httpx2.Request] = []

    def handler(request: httpx2.Request) -> httpx2.Response:
        requests.append(request)
        return httpx2.Response(200, json=message(json.dumps(REVIEW)))

    review = provider(handler).generate("system", "diff", Review, REVIEW_SCHEMA)

    assert review.verdict == "approve"
    body = json.loads(requests[0].content)
    assert body["model"] == "claude-opus-5-5"
    assert body["system"] == "system"
    assert body["output_config"]["format"]["type"] == "json_schema"
    assert body["fallbacks"] == "default"
    assert "server-side-fallback-2026-07-01" in requests[0].headers["anthropic-beta"]


def test_refusal() -> None:
    with pytest.raises(ProviderError, match="declined"):
        provider(lambda _: httpx2.Response(200, json=message("", "refusal"))).generate(
            "s", "p", Review, REVIEW_SCHEMA
        )


def test_truncated_output() -> None:
    with pytest.raises(ProviderError, match="max_tokens"):
        provider(lambda _: httpx2.Response(200, json=message("{", "max_tokens"))).generate(
            "s", "p", Review, REVIEW_SCHEMA
        )


def test_api_errors() -> None:
    error = {"type": "error", "error": {"type": "authentication_error", "message": "bad key"}}
    with pytest.raises(ProviderError, match="API key"):
        provider(lambda _: httpx2.Response(401, json=error)).generate(
            "s", "p", Review, REVIEW_SCHEMA
        )


def test_from_env() -> None:
    created = AnthropicProvider.from_env(
        {"ANTHROPIC_API_KEY": "sk", "DOPS_ANTHROPIC_MODEL": "claude-sonnet-5-5"}
    )
    assert created.model == "claude-sonnet-5-5"
    assert created.effort == "medium"
    with pytest.raises(ProviderError, match="DOPS_ANTHROPIC_EFFORT"):
        AnthropicProvider.from_env({"DOPS_ANTHROPIC_EFFORT": "extreme"})
