from dops_ai_review.git import Diff
from dops_ai_review.prompts import build_prompt


def test_prompt_wraps_diff_and_context() -> None:
    prompt = build_prompt(Diff(text="+x\n", files=["a"], omitted=["big.sql"]), "Ticket text")
    assert prompt.startswith("<context>\nTicket text\n</context>")
    assert "big.sql" in prompt
    assert prompt.endswith("<diff>\n+x\n</diff>")
