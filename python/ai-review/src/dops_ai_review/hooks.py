"""Installing ``dops-ai`` as a git pre-push hook."""

import shlex
import sys
from pathlib import Path

from dops_ai_review.git import run_git

MARKER = "# installed by dops-ai"

PRE_PUSH = """\
#!/bin/sh
{marker}
# Reviews the commits about to be pushed. Skip once with DOPS_AI_SKIP=1 or --no-verify.
[ -n "$DOPS_AI_SKIP" ] && exit 0

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{{upstream}}' 2>/dev/null)
if [ -n "$upstream" ]; then range="$upstream...HEAD"; else range="HEAD~1"; fi

{command} review --diff "$range" --provider "${{DOPS_AI_PROVIDER:-{provider}}}"
status=$?
if [ "$status" -eq 1 ]; then
  echo "dops-ai: the review asks for changes (DOPS_AI_SKIP=1 git push to ignore)" >&2
  exit 1
fi
# Errors (no API key, network) never block a push.
exit 0
"""


class HookError(RuntimeError):
    """The hook cannot be installed or removed."""


def hook_path(cwd: Path | None = None) -> Path:
    """Where git looks for the pre-push hook (respects core.hooksPath)."""
    path = Path(run_git(["rev-parse", "--git-path", "hooks/pre-push"], cwd).strip())
    return path if path.is_absolute() else (cwd or Path.cwd()) / path


def render_hook(provider: str, python: str = sys.executable) -> str:
    command = f"{shlex.quote(python)} -m dops_ai_review"
    return PRE_PUSH.format(marker=MARKER, command=command, provider=provider)


def install_hook(provider: str = "openai", *, force: bool = False, cwd: Path | None = None) -> Path:
    path = hook_path(cwd)
    if path.exists() and MARKER not in path.read_text() and not force:
        raise HookError(f"{path} already exists; use --force to replace it")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(render_hook(provider))
    path.chmod(0o755)
    return path


def uninstall_hook(cwd: Path | None = None) -> Path | None:
    path = hook_path(cwd)
    if not path.exists():
        return None
    if MARKER not in path.read_text():
        raise HookError(f"{path} was not installed by dops-ai; leaving it alone")
    path.unlink()
    return path
