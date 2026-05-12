"""
Spark Tool - Tool definition and decorator.
"""

from dataclasses import dataclass
from typing import Any, Callable


@dataclass
class Tool:
    """A tool that the agent can use."""

    name: str
    description: str
    func: Callable[..., Any]

    def run(self, *args: Any, **kwargs: Any) -> Any:
        """Execute the tool."""
        return self.func(*args, **kwargs)

    def __call__(self, *args: Any, **kwargs: Any) -> Any:
        """Make the tool directly callable."""
        return self.run(*args, **kwargs)


def tool(func: Callable) -> Tool:
    """
    Decorator to convert a function into a Tool.

    Example:
        @tool
        def search(query: str) -> str:
            \"\"\"Search the web for information.\"\"\"
            return "Results for: " + query
    """
    name = func.__name__
    description = func.__doc__ or f"Tool: {name}"
    return Tool(name=name, description=description, func=func)
