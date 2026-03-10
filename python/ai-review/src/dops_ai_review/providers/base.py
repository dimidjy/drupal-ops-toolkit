from typing import Any, Protocol, TypeVar

from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class ProviderError(RuntimeError):
    """The model API failed or returned something unusable."""


class Provider(Protocol):
    name: str
    model: str

    def generate(self, system: str, prompt: str, output: type[T], schema: dict[str, Any]) -> T:
        """Asks the model for JSON matching ``schema`` and validates it as ``output``."""
        ...
