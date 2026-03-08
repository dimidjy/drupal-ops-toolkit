import os
import subprocess
from pathlib import Path

import pytest

from dops_ai_review.hooks import MARKER, HookError, install_hook, render_hook, uninstall_hook

from .conftest import git


def test_install_and_uninstall(repo: Path) -> None:
    path = install_hook("anthropic", cwd=repo)
    assert path == repo / ".git" / "hooks" / "pre-push"
    assert os.access(path, os.X_OK)
    assert "${DOPS_AI_PROVIDER:-anthropic}" in path.read_text()
    assert uninstall_hook(cwd=repo) == path
    assert not path.exists()


def test_respects_core_hooks_path(repo: Path) -> None:
    git(repo, "config", "core.hooksPath", ".githooks")
    assert install_hook(cwd=repo) == repo / ".githooks" / "pre-push"


def test_keeps_foreign_hooks(repo: Path) -> None:
    path = repo / ".git" / "hooks" / "pre-push"
    path.write_text("#!/bin/sh\nexit 0\n")
    with pytest.raises(HookError, match="--force"):
        install_hook(cwd=repo)
    with pytest.raises(HookError, match="not installed by dops-ai"):
        uninstall_hook(cwd=repo)
    install_hook(force=True, cwd=repo)
    assert MARKER in path.read_text()


def run_hook(repo: Path, python: Path, env: dict[str, str] | None = None) -> int:
    hook = repo / "hook.sh"
    hook.write_text(render_hook("openai", str(python)))
    return subprocess.run(
        ["sh", str(hook)], cwd=repo, env={**os.environ, **(env or {})}, check=False
    ).returncode


@pytest.mark.parametrize(("review_status", "push_status"), [(0, 0), (1, 1), (2, 0)])
def test_hook_blocks_only_on_request_changes(
    repo: Path, tmp_path: Path, review_status: int, push_status: int
) -> None:
    fake_python = tmp_path / "fake-python"
    fake_python.write_text(f"#!/bin/sh\nexit {review_status}\n")
    fake_python.chmod(0o755)
    assert run_hook(repo, fake_python) == push_status
    assert run_hook(repo, fake_python, {"DOPS_AI_SKIP": "1"}) == 0
