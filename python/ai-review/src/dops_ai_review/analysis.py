"""AI read-through of a Jira issue before starting work on it."""

from typing import Any

from pydantic import BaseModel, Field

from dops_ai_review.jira import IssueDetails
from dops_ai_review.providers import Provider


class IssueAnalysis(BaseModel):
    summary: str
    acceptance_criteria: list[str] = Field(default_factory=list)
    technical_notes: list[str] = Field(default_factory=list)
    risks: list[str] = Field(default_factory=list)
    questions: list[str] = Field(default_factory=list)
    suggested_steps: list[str] = Field(default_factory=list)


def _list(description: str) -> dict[str, Any]:
    return {"type": "array", "items": {"type": "string"}, "description": description}


ANALYSIS_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "summary",
        "acceptance_criteria",
        "technical_notes",
        "risks",
        "questions",
        "suggested_steps",
    ],
    "properties": {
        "summary": {"type": "string", "description": "What is asked, in two or three sentences."},
        "acceptance_criteria": _list("Testable conditions, from the issue or clearly implied."),
        "technical_notes": _list("Drupal parts likely involved: modules, config, entities, hooks."),
        "risks": _list("What could break or be misunderstood."),
        "questions": _list("Questions to ask before starting; empty when the issue is clear."),
        "suggested_steps": _list("Order of work, short imperative steps."),
    },
}

ANALYSIS_SYSTEM = """\
You are a senior Drupal developer reading a Jira issue before starting work on it.
Use only what the issue, its comments and related issues say; mark assumptions as such.
Be concrete and brief. Write acceptance criteria a tester could check."""


def analyze_issue(details: IssueDetails, provider: Provider) -> IssueAnalysis:
    prompt = f"<issue>\n{details.as_context()}\n</issue>"
    return provider.generate(ANALYSIS_SYSTEM, prompt, IssueAnalysis, ANALYSIS_SCHEMA)
