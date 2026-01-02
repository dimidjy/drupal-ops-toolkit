from typer.testing import CliRunner

from dops_ai_review import __version__
from dops_ai_review.cli import app

runner = CliRunner()


def test_version() -> None:
    result = runner.invoke(app, ["--version"])
    assert result.exit_code == 0
    assert result.stdout.strip() == __version__
