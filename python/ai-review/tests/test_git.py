from pathlib import Path

import pytest

from dops_ai_review.git import GitError, collect_diff, fit_to_budget, split_files

from .conftest import git

TWO_FILES = """diff --git a/a.php b/a.php
--- a/a.php
+++ b/a.php
@@ -1 +1 @@
-old
+new
diff --git a/b.php b/b.php
--- a/b.php
+++ b/b.php
@@ -1 +1 @@
-x
+y
"""


def test_split_files() -> None:
    sections = split_files(TWO_FILES)
    assert [path for path, _ in sections] == ["a.php", "b.php"]
    assert sections[0][1].endswith("+new\n")


def test_fit_to_budget_keeps_whole_files() -> None:
    first = len(split_files(TWO_FILES)[0][1])
    diff = fit_to_budget(TWO_FILES, first + 5)
    assert diff.files == ["a.php"]
    assert diff.omitted == ["b.php"]
    assert "b.php" not in diff.text


def test_working_tree_diff(repo: Path) -> None:
    (repo / "README.md").write_text("# demo\nmore\n")
    diff = collect_diff(cwd=repo)
    assert diff.files == ["README.md"]
    assert "+more" in diff.text


def test_lock_files_are_excluded(repo: Path) -> None:
    (repo / "web").mkdir()
    (repo / "composer.lock").write_text("{}\n")
    (repo / "web" / "app.min.js").write_text("x\n")
    (repo / "module.php").write_text("<?php\n")
    git(repo, "add", ".")
    git(repo, "commit", "-q", "-m", "add files")
    diff = collect_diff("HEAD~1", cwd=repo)
    assert diff.files == ["module.php"]


def test_staged_only(repo: Path) -> None:
    (repo / "staged.txt").write_text("a\n")
    git(repo, "add", "staged.txt")
    (repo / "README.md").write_text("changed\n")
    assert collect_diff(staged=True, cwd=repo).files == ["staged.txt"]


def test_unknown_revision(repo: Path) -> None:
    with pytest.raises(GitError):
        collect_diff("does-not-exist", cwd=repo)
