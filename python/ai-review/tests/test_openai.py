import json

import httpx
import pytest
import respx

from dops_ai_review.providers import OpenAIProvider, ProviderError

URL = "https://api.openai.com/v1/chat/completions"
REVIEW = {
    "summary": "Adds a block plugin.",
    "verdict": "comment",
    "findings": [
        {"file": "src/Plugin/Block/Promo.php", "line": 12, "severity": "minor", "message": "x"}
    ],
}


def completion(content: str, refusal: str | None = None) -> dict[str, object]:
    message = {"role": "assistant", "content": content, "refusal": refusal}
    return {"choices": [{"message": message}]}


@respx.mock
def test_review_sends_schema_and_parses_result() -> None:
    route = respx.post(URL).respond(json=completion(json.dumps(REVIEW)))
    review = OpenAIProvider("sk-test").review("system", "diff")

    assert review.verdict == "comment"
    assert review.findings[0].line == 12
    body = json.loads(route.calls.last.request.content)
    assert body["response_format"]["json_schema"]["strict"] is True
    assert body["messages"][0] == {"role": "system", "content": "system"}
    assert route.calls.last.request.headers["authorization"] == "Bearer sk-test"


@respx.mock
def test_api_errors_are_readable() -> None:
    respx.post(URL).respond(401, json={"error": {"message": "Incorrect API key"}})
    with pytest.raises(ProviderError, match="401: Incorrect API key"):
        OpenAIProvider("bad").review("s", "p")


@respx.mock
def test_refusal() -> None:
    respx.post(URL).respond(json=completion("", refusal="no"))
    with pytest.raises(ProviderError, match="refused"):
        OpenAIProvider("sk").review("s", "p")


@respx.mock
def test_invalid_content() -> None:
    respx.post(URL).respond(json=completion('{"summary": "x"}'))
    with pytest.raises(ProviderError, match="Unexpected review format"):
        OpenAIProvider("sk").review("s", "p")


@respx.mock
def test_network_error() -> None:
    respx.post(URL).mock(side_effect=httpx.ConnectError("boom"))
    with pytest.raises(ProviderError, match="request failed"):
        OpenAIProvider("sk").review("s", "p")


def test_from_env() -> None:
    with pytest.raises(ProviderError, match="OPENAI_API_KEY"):
        OpenAIProvider.from_env({})
    provider = OpenAIProvider.from_env({"OPENAI_API_KEY": "sk", "DOPS_OPENAI_MODEL": "gpt-x"})
    assert provider.model == "gpt-x"
