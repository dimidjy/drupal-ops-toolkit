"""Structured review results returned by every provider."""

from typing import Any, Literal

from pydantic import BaseModel, Field

Severity = Literal["info", "minor", "major", "critical"]
Verdict = Literal["approve", "comment", "request_changes"]


class Finding(BaseModel):
    file: str
    line: int | None = None
    severity: Severity
    message: str


class Review(BaseModel):
    summary: str
    verdict: Verdict
    findings: list[Finding] = Field(default_factory=list)


# Written by hand rather than generated: strict structured output needs every
# property listed as required and nullable fields spelled as type unions.
REVIEW_SCHEMA: dict[str, Any] = {
    "type": "object",
    "additionalProperties": False,
    "required": ["summary", "verdict", "findings"],
    "properties": {
        "summary": {"type": "string", "description": "Two or three sentences on the change."},
        "verdict": {"type": "string", "enum": ["approve", "comment", "request_changes"]},
        "findings": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": ["file", "line", "severity", "message"],
                "properties": {
                    "file": {"type": "string"},
                    "line": {"type": ["integer", "null"]},
                    "severity": {"type": "string", "enum": ["info", "minor", "major", "critical"]},
                    "message": {"type": "string"},
                },
            },
        },
    },
}
