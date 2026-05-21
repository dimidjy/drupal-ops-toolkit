from dops_ai_review.jira import JiraClient, JiraIssue
from dops_ai_review.report import my_work_jql, render_markdown


def test_jql() -> None:
    assert my_work_jql(3).startswith("assignee = currentUser() AND updated >= -3d")


def test_markdown_groups_by_status_with_links() -> None:
    jira = JiraClient("https://example.atlassian.net/", "me@example.com", "token")
    issues = [
        JiraIssue(key="A-1", summary="Promo block", status="Done", issue_type="Story"),
        JiraIssue(key="A-2", summary="Cart fix", status="In Review", issue_type="Bug"),
    ]
    assert render_markdown(issues, jira.browse_url, "Week 21") == (
        "## Week 21\n\n"
        "### Done\n- [A-1](https://example.atlassian.net/browse/A-1) Promo block\n\n"
        "### In Review\n- [A-2](https://example.atlassian.net/browse/A-2) Cart fix\n"
    )


def test_empty_period() -> None:
    assert "_No issues updated" in render_markdown([], str, "Week 1")
