import json
from typing import Any

import pytest
import respx
from typer.testing import CliRunner

from dops_ai_review import cli
from dops_ai_review.analysis import IssueAnalysis, analyze_issue
from dops_ai_review.jira import JiraClient, related_keys
from dops_ai_review.providers.base import T

BASE = "https://example.atlassian.net/rest/api/3"
TEXT = {
    "type": "doc",
    "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Add a promo block."}]}],
}


def issue(key: str, **fields: Any) -> dict[str, Any]:
    return {
        "key": key,
        "fields": {
            "summary": f"Summary of {key}",
            "status": {"name": "To Do"},
            "issuetype": {"name": "Story"},
            "description": TEXT,
            **fields,
        },
    }


MAIN = issue(
    "SHOP-7",
    comment={
        "comments": [
            {
                "author": {"displayName": "PO"},
                "body": TEXT,
                "created": "2026-05-20T09:00:00.000+0200",
            }
        ]
    },
    issuelinks=[{"outwardIssue": {"key": "SHOP-8"}}, {"inwardIssue": {"key": "SHOP-9"}}],
    subtasks=[{"key": "SHOP-10"}],
    parent={"key": "SHOP-1"},
)


def client() -> JiraClient:
    return JiraClient("https://example.atlassian.net", "me@example.com", "token")


def test_related_keys() -> None:
    assert related_keys(MAIN["fields"]) == ["SHOP-8", "SHOP-9", "SHOP-10", "SHOP-1"]


@respx.mock
def test_details_with_comments_and_related() -> None:
    respx.get(f"{BASE}/issue/SHOP-7").respond(json=MAIN)
    for key in ("SHOP-8", "SHOP-9", "SHOP-10", "SHOP-1"):
        respx.get(f"{BASE}/issue/{key}").respond(json=issue(key))
    details = client().get_details("SHOP-7", raw=True)
    assert details.comments[0].author == "PO"
    assert [r.key for r in details.related] == ["SHOP-8", "SHOP-9", "SHOP-10", "SHOP-1"]
    assert details.raw is not None
    assert details.url == "https://example.atlassian.net/browse/SHOP-7"
    assert "Related issues:\n- SHOP-8" in details.as_context()


class FakeProvider:
    name = "fake"
    model = "fake"

    def __init__(self) -> None:
        self.prompts: list[str] = []

    def generate(self, system: str, prompt: str, output: type[T], schema: dict[str, Any]) -> T:
        self.prompts.append(prompt)
        return output.model_validate(
            {"summary": "Promo block.", "acceptance_criteria": ["Shows on the home page"]}
        )


@respx.mock
def test_analysis_and_cli_json(monkeypatch: pytest.MonkeyPatch) -> None:
    respx.get(f"{BASE}/issue/SHOP-7").respond(json=issue("SHOP-7"))
    provider = FakeProvider()
    details = client().get_details("SHOP-7", related=False)
    analysis = analyze_issue(details, provider)
    assert isinstance(analysis, IssueAnalysis)
    assert "<issue>\nSHOP-7 [Story, To Do]" in provider.prompts[0]

    monkeypatch.setattr(cli.JiraClient, "from_env", lambda _env: client())
    monkeypatch.setattr(cli, "get_provider", lambda *_: provider)
    result = CliRunner().invoke(cli.app, ["issue", "shop-7", "--no-related", "--analyze", "--json"])
    assert result.exit_code == 0, result.stdout
    data = json.loads(result.stdout)
    assert data["issue"]["key"] == "SHOP-7"
    assert data["analysis"]["acceptance_criteria"] == ["Shows on the home page"]
    assert data["raw"] is None
