import json
from typing import Any

import pytest
import respx

from dops_ai_review.jira import JiraClient, JiraError, adf_to_text, issue_keys

BASE = "https://example.atlassian.net/rest/api/3"

DESCRIPTION = {
    "type": "doc",
    "version": 1,
    "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Add a promo block."}]},
        {
            "type": "bulletList",
            "content": [
                {
                    "type": "listItem",
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": "Cacheable"}]}
                    ],
                },
                {
                    "type": "listItem",
                    "content": [
                        {"type": "paragraph", "content": [{"type": "text", "text": "Translatable"}]}
                    ],
                },
            ],
        },
    ],
}


def issue(key: str, status: str = "In Progress") -> dict[str, Any]:
    return {
        "key": key,
        "fields": {
            "summary": f"Summary of {key}",
            "status": {"name": status},
            "issuetype": {"name": "Story"},
            "priority": {"name": "High"},
            "assignee": {"displayName": "Dev One"},
            "labels": ["frontend"],
            "description": DESCRIPTION,
        },
    }


def client() -> JiraClient:
    return JiraClient("https://example.atlassian.net/", "me@example.com", "token")


def test_issue_keys() -> None:
    assert issue_keys("SHOP-12: fix cart (see SHOP-3, SHOP-12, utf-8)") == ["SHOP-12", "SHOP-3"]


def test_adf_to_text() -> None:
    assert adf_to_text(DESCRIPTION).strip() == "Add a promo block.\n\n- Cacheable\n- Translatable"
    assert adf_to_text(None) == ""


@respx.mock
def test_get_issue() -> None:
    route = respx.get(f"{BASE}/issue/SHOP-1").respond(json=issue("SHOP-1"))
    result = client().get_issue("SHOP-1")
    assert result.status == "In Progress"
    assert result.assignee == "Dev One"
    assert "- Cacheable" in result.description
    assert result.as_context().startswith("SHOP-1 [Story, In Progress] Summary of SHOP-1")
    assert route.calls.last.request.headers["authorization"].startswith("Basic ")


@respx.mock
def test_search_follows_pages() -> None:
    route = respx.post(f"{BASE}/search/jql").mock(
        side_effect=[
            respx.MockResponse(json={"issues": [issue("A-1")], "nextPageToken": "p2"}),
            respx.MockResponse(json={"issues": [issue("A-2", "Done")]}),
        ]
    )
    results = client().search("project = A")
    assert [i.key for i in results] == ["A-1", "A-2"]
    assert json.loads(route.calls[1].request.content)["nextPageToken"] == "p2"


@respx.mock
def test_errors() -> None:
    respx.get(f"{BASE}/issue/NOPE-1").respond(404)
    with pytest.raises(JiraError, match="404"):
        client().get_issue("NOPE-1")


def test_from_env_lists_missing_variables() -> None:
    with pytest.raises(JiraError, match="JIRA_EMAIL, JIRA_API_TOKEN"):
        JiraClient.from_env({"JIRA_URL": "https://x.atlassian.net"})
