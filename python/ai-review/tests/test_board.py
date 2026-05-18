from datetime import UTC, datetime, timedelta

from dops_ai_review.board import board_prompt, group_by_status, is_stale
from dops_ai_review.jira import JiraIssue

NOW = datetime(2026, 5, 18, 12, tzinfo=UTC)


def issue(key: str, status: str, days_ago: int | None = None) -> JiraIssue:
    updated = NOW - timedelta(days=days_ago) if days_ago is not None else None
    return JiraIssue(key=key, summary=key, status=status, issue_type="Task", updated=updated)


def test_group_by_status_keeps_order() -> None:
    groups = group_by_status([issue("A-1", "To Do"), issue("A-2", "Done"), issue("A-3", "To Do")])
    assert {status: [i.key for i in group] for status, group in groups.items()} == {
        "To Do": ["A-1", "A-3"],
        "Done": ["A-2"],
    }


def test_stale_only_for_active_statuses() -> None:
    assert is_stale(issue("A-1", "In Progress", 6), NOW)
    assert is_stale(issue("A-1", "Code Review", 5), NOW)
    assert not is_stale(issue("A-1", "In Progress", 2), NOW)
    assert not is_stale(issue("A-1", "To Do", 30), NOW)
    assert not is_stale(issue("A-1", "In Progress"), NOW)


def test_prompt_mentions_assignee_and_idle_time() -> None:
    old = JiraIssue(
        key="A-9",
        summary="Payment webhook",
        status="In Progress",
        issue_type="Bug",
        updated=datetime(2020, 1, 1, tzinfo=UTC),
    )
    prompt = board_prompt([old])
    assert prompt.startswith("## In Progress (1)\n- A-9 [Bug, unassigned] Payment webhook")
    assert "no update for" in prompt
