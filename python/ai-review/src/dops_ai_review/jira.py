"""Minimal Jira Cloud client: read issues and search with JQL."""

from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any

import httpx
from pydantic import BaseModel, Field

ISSUE_KEY = re.compile(r"\b([A-Z][A-Z0-9]{1,9}-\d+)\b")
FIELDS = [
    "summary",
    "description",
    "status",
    "issuetype",
    "priority",
    "assignee",
    "labels",
    "updated",
]


class JiraError(RuntimeError):
    """Jira is not configured or the request failed."""


class JiraIssue(BaseModel):
    key: str
    summary: str
    status: str
    issue_type: str
    priority: str | None = None
    assignee: str | None = None
    labels: list[str] = Field(default_factory=list)
    description: str = ""
    updated: datetime | None = None

    def idle_days(self, now: datetime | None = None) -> int | None:
        """Whole days since the issue was last updated."""
        if self.updated is None:
            return None
        return ((now or datetime.now(UTC)) - self.updated).days

    def as_context(self) -> str:
        """The issue as plain text for a prompt."""
        lines = [f"{self.key} [{self.issue_type}, {self.status}] {self.summary}"]
        if self.description:
            lines.append(self.description)
        return "\n".join(lines)


def issue_keys(text: str) -> list[str]:
    """Issue keys mentioned in ``text``, in order, without duplicates."""
    return list(dict.fromkeys(ISSUE_KEY.findall(text)))


def adf_to_text(node: Any) -> str:
    """Flattens an Atlassian Document Format tree to plain text."""
    if not isinstance(node, dict):
        return ""
    kind = node.get("type")
    if kind == "text":
        return str(node.get("text", ""))
    if kind == "hardBreak":
        return "\n"
    if kind in ("mention", "emoji"):
        return str(node.get("attrs", {}).get("text", ""))
    children = [adf_to_text(child) for child in node.get("content", [])]
    if kind == "listItem":
        return "- " + "".join(children).strip() + "\n"
    if kind in ("paragraph", "heading", "codeBlock", "blockquote"):
        return "".join(children).strip() + "\n\n"
    return "".join(children)


def _name(field: Any, key: str = "name") -> str | None:
    return str(field[key]) if isinstance(field, dict) and field.get(key) else None


def parse_time(value: Any) -> datetime | None:
    """Jira timestamps look like 2026-05-18T10:12:33.000+0200."""
    if not isinstance(value, str):
        return None
    try:
        return datetime.strptime(value, "%Y-%m-%dT%H:%M:%S.%f%z")
    except ValueError:
        return None


def parse_issue(data: Mapping[str, Any]) -> JiraIssue:
    fields = data.get("fields", {})
    return JiraIssue(
        key=data["key"],
        summary=fields.get("summary") or "",
        status=_name(fields.get("status")) or "unknown",
        issue_type=_name(fields.get("issuetype")) or "unknown",
        priority=_name(fields.get("priority")),
        assignee=_name(fields.get("assignee"), "displayName"),
        labels=fields.get("labels") or [],
        description=adf_to_text(fields.get("description")).strip(),
        updated=parse_time(fields.get("updated")),
    )


class JiraClient:
    def __init__(
        self, base_url: str, email: str, token: str, *, client: httpx.Client | None = None
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self._client = client or httpx.Client(
            base_url=self.base_url + "/rest/api/3",
            auth=(email, token),
            headers={"Accept": "application/json"},
            timeout=30,
        )

    @classmethod
    def from_env(cls, env: Mapping[str, str]) -> JiraClient:
        missing = [
            name for name in ("JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN") if not env.get(name)
        ]
        if missing:
            raise JiraError(f"Jira is not configured: set {', '.join(missing)}")
        return cls(env["JIRA_URL"], env["JIRA_EMAIL"], env["JIRA_API_TOKEN"])

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(method, path, **kwargs)
            response.raise_for_status()
        except httpx.HTTPStatusError as error:
            status = error.response.status_code
            raise JiraError(f"Jira {method} {path} returned {status}") from error
        except httpx.HTTPError as error:
            raise JiraError(f"Jira request failed: {error}") from error
        return response.json()

    def browse_url(self, key: str) -> str:
        return f"{self.base_url}/browse/{key}"

    def get_issue(self, key: str) -> JiraIssue:
        return parse_issue(
            self._request("GET", f"/issue/{key}", params={"fields": ",".join(FIELDS)})
        )

    def search(self, jql: str, limit: int = 100) -> list[JiraIssue]:
        """Issues matching ``jql``, following pagination up to ``limit``."""
        issues: list[JiraIssue] = []
        token: str | None = None
        while len(issues) < limit:
            body: dict[str, Any] = {
                "jql": jql,
                "fields": FIELDS,
                "maxResults": min(50, limit - len(issues)),
            }
            if token:
                body["nextPageToken"] = token
            page = self._request("POST", "/search/jql", json=body)
            issues += [parse_issue(item) for item in page.get("issues", [])]
            token = page.get("nextPageToken")
            if not token:
                break
        return issues
