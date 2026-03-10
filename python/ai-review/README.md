# dops-ai-review

Python part of drupal-ops-toolkit. It sends git diffs to an LLM and prints a
structured review, checks commits against their Jira tickets and summarises a
Jira board before stand-up.

```bash
uv sync
export OPENAI_API_KEY=...            # or ANTHROPIC_API_KEY with --provider anthropic
```

## Review a diff

```bash
uv run dops-ai review                    # uncommitted changes
uv run dops-ai review --staged           # what is about to be committed
uv run dops-ai review --diff main...     # whole branch
uv run dops-ai review --context ticket.txt --json
```

Every provider returns the same JSON structure (summary, verdict, and findings
with file, line, severity and message), enforced by a JSON schema. Lock files,
minified assets and source maps are left out. Large diffs keep whole files up
to a size budget and list the files they skipped.

Exit codes: `1` when the verdict is `request_changes` (`--no-strict` turns this
off), `2` on git, Jira or API errors.

## Review a commit against its Jira tickets

```bash
uv run dops-ai commit            # HEAD
uv run dops-ai commit abc123
```

Issue keys in the commit message (`SHOP-42: ...`) are loaded from Jira and sent
along with the diff. The model also checks whether the change does what the
ticket asks, and reports missing parts as findings on `(ticket)`.

## Pre-push hook

```bash
uv run dops-ai hook install --provider anthropic
DOPS_AI_SKIP=1 git push         # skip once
uv run dops-ai hook uninstall
```

The hook reviews `@{upstream}...HEAD` and blocks the push only on
`request_changes`. A missing key or a network error never blocks a push.

## Board summary

```bash
uv run dops-ai board --jql "project = SHOP AND sprint in openSprints()" --summarize
```

## Configuration

| Variable                                   | Purpose                                             |
| ------------------------------------------ | --------------------------------------------------- |
| `OPENAI_API_KEY`                           | OpenAI provider                                     |
| `DOPS_OPENAI_MODEL`                        | default `gpt-4.1-mini`                              |
| `ANTHROPIC_API_KEY`                        | Anthropic provider (or an `ant auth login` profile) |
| `DOPS_ANTHROPIC_MODEL`                     | default `claude-opus-5-5`                           |
| `DOPS_ANTHROPIC_EFFORT`                    | `low` … `max`, default `medium`                     |
| `JIRA_URL`, `JIRA_EMAIL`, `JIRA_API_TOKEN` | Jira Cloud, API token auth                          |
| `DOPS_JIRA_JQL`                            | default query for `board`                           |
| `DOPS_AI_PROVIDER`                         | provider used by the pre-push hook                  |

## Development

```bash
uv run ruff check && uv run ruff format --check
uv run mypy
uv run pytest       # HTTP calls are mocked, no keys needed
```
