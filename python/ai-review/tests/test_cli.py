import json
from pathlib import Path

import pytest
from typer.testing import CliRunner

from dops_ai_review import __version__, cli
from dops_ai_review.jira import JiraIssue
from dops_ai_review.models import Finding, Review

from .conftest import git

runner = CliRunner()


class FakeProvider:
    name = "fake"
    model = "fake-1"

    def __init__(self, review: Review) -> None:
        self.result = review
        self.prompts: list[str] = []

    def review(self, system: str, prompt: str) -> Review:
        self.prompts.append(prompt)
        return self.result


@pytest.fixture
def fake(monkeypatch: pytest.MonkeyPatch, repo: Path) -> FakeProvider:
    provider = FakeProvider(
        Review(
            summary="Adds a helper.",
            verdict="request_changes",
            findings=[Finding(file="a.php", line=3, severity="major", message="Unescaped output")],
        )
    )
    monkeypatch.setattr(cli, "get_provider", lambda *_: provider)
    monkeypatch.chdir(repo)
    (repo / "a.php").write_text("<?php\necho $_GET['q'];\n")
    (repo / "README.md").write_text("# demo\nchanged\n")
    return provider


def test_version() -> None:
    result = runner.invoke(cli.app, ["--version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == __version__


def test_review_prints_findings_and_fails_on_request_changes(fake: FakeProvider) -> None:
    result = runner.invoke(cli.app, ["review"])
    assert result.exit_code == 1
    assert "Unescaped output" in result.stdout
    assert "a.php:3" in result.stdout
    assert "+changed" in fake.prompts[0]


def test_review_json_and_no_strict(fake: FakeProvider) -> None:
    result = runner.invoke(cli.app, ["review", "--json", "--no-strict"])
    assert result.exit_code == 0
    assert json.loads(result.stdout)["findings"][0]["severity"] == "major"


def test_context_file_is_sent(fake: FakeProvider, tmp_path: Path) -> None:
    ticket = tmp_path / "ticket.txt"
    ticket.write_text("Search page must escape the query")
    runner.invoke(cli.app, ["review", "--context", str(ticket)])
    assert "<context>\nSearch page must escape the query\n</context>" in fake.prompts[0]


def test_git_errors_exit_with_2(fake: FakeProvider) -> None:
    result = runner.invoke(cli.app, ["review", "--diff", "nope"])
    assert result.exit_code == 2


def test_commit_review_loads_tickets(
    fake: FakeProvider, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    class FakeJira:
        def get_issue(self, key: str) -> JiraIssue:
            return JiraIssue(
                key=key,
                summary="Escape search input",
                status="In Progress",
                issue_type="Bug",
                description="The query is printed raw.",
            )

    monkeypatch.setattr(cli.JiraClient, "from_env", lambda _env: FakeJira())
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "SHOP-7: print search query")

    result = runner.invoke(cli.app, ["commit", "--no-strict"])

    assert result.exit_code == 0
    prompt = fake.prompts[0]
    assert "<tickets>\nSHOP-7 [Bug, In Progress] Escape search input" in prompt
    assert "<commit_message>\nSHOP-7: print search query\n</commit_message>" in prompt
    assert "a.php" in prompt


def test_commit_review_without_jira_config(
    fake: FakeProvider, repo: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    for name in ("JIRA_URL", "JIRA_EMAIL", "JIRA_API_TOKEN"):
        monkeypatch.delenv(name, raising=False)
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "SHOP-7: print search query")

    result = runner.invoke(cli.app, ["commit", "--no-strict"])

    assert result.exit_code == 0
    assert "<tickets>" not in fake.prompts[0]
