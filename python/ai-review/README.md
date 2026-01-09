# dops-ai-review

Python part of drupal-ops-toolkit: sends a git diff to an LLM and prints a
structured review (summary, verdict, findings with file, line and severity).

```bash
uv sync
export OPENAI_API_KEY=...

uv run dops-ai review                    # uncommitted changes
uv run dops-ai review --staged           # what is about to be committed
uv run dops-ai review --diff HEAD~1      # last commit
uv run dops-ai review --diff main...     # whole branch
uv run dops-ai review --context ticket.txt --json
```

Lock files, minified assets and source maps are left out of the diff. Large
diffs keep whole files up to a size budget and list the skipped ones.

The exit code is 1 when the verdict is `request_changes` (`--no-strict` turns
that off) and 2 on git or API errors.

| Variable            | Purpose                                 |
| ------------------- | --------------------------------------- |
| `OPENAI_API_KEY`    | API key                                 |
| `DOPS_OPENAI_MODEL` | Model override (default `gpt-4.1-mini`) |

## Development

```bash
uv run ruff check && uv run ruff format --check
uv run mypy
uv run pytest       # HTTP calls are mocked, no key needed
```
