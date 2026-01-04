"""Collecting diffs from git."""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

# Generated or vendored files that cost tokens and say nothing about the change.
EXCLUDED = (
    "composer.lock",
    "package-lock.json",
    "yarn.lock",
    "pnpm-lock.yaml",
    "uv.lock",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.svg",
)

_FILE_HEADER = re.compile(r"^diff --git a/(.+?) b/(.+)$", re.MULTILINE)


class GitError(RuntimeError):
    """A git command failed."""


@dataclass(frozen=True)
class Diff:
    text: str
    files: list[str]
    omitted: list[str] = field(default_factory=list)

    @property
    def empty(self) -> bool:
        return not self.text.strip()


def run_git(args: list[str], cwd: Path | None = None) -> str:
    result = subprocess.run(["git", *args], cwd=cwd, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        raise GitError(result.stderr.strip() or f"git {' '.join(args)} failed")
    return result.stdout


def split_files(diff: str) -> list[tuple[str, str]]:
    """Splits a unified diff into ``(path, section)`` pairs, one per file."""
    starts = [m.start() for m in _FILE_HEADER.finditer(diff)]
    sections = []
    for i, start in enumerate(starts):
        end = starts[i + 1] if i + 1 < len(starts) else len(diff)
        section = diff[start:end]
        match = _FILE_HEADER.match(section)
        assert match is not None
        sections.append((match.group(2), section))
    return sections


def fit_to_budget(diff: str, max_chars: int) -> Diff:
    """Keeps whole files, in order, while they fit into ``max_chars``."""
    kept: list[str] = []
    files: list[str] = []
    omitted: list[str] = []
    used = 0
    for path, section in split_files(diff):
        if used + len(section) <= max_chars:
            kept.append(section)
            files.append(path)
            used += len(section)
        else:
            omitted.append(path)
    return Diff(text="".join(kept), files=files, omitted=omitted)


def collect_diff(
    rev: str | None = None,
    *,
    staged: bool = False,
    cwd: Path | None = None,
    max_chars: int = 60_000,
) -> Diff:
    """Diff of the working tree (default), the index (``staged``) or ``rev``.

    ``rev`` is passed to ``git diff`` as is, so ``HEAD~1``, ``main...feature``
    and ``abc123..def456`` all work.
    """
    args = ["diff", "--no-color", "--no-ext-diff", "--unified=3"]
    if staged:
        args.append("--cached")
    args.append(rev or "HEAD")
    args += ["--", ".", *(f":(exclude,glob)**/{pattern}" for pattern in EXCLUDED)]
    return fit_to_budget(run_git(args, cwd), max_chars)
