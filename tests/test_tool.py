"""
Tests for Tool.
"""

from spark import tool, Tool


def test_tool_decorator():
    """Test that @tool decorator creates a Tool."""

    @tool
    def search(query: str) -> str:
        """Search the web."""
        return f"Results: {query}"

    assert isinstance(search, Tool)
    assert search.name == "search"
    assert search.description == "Search the web."
    assert search.run("hello") == "Results: hello"


def test_tool_without_docstring():
    """Test tool without docstring gets default description."""

    @tool
    def noop(x: int) -> int:
        return x

    assert noop.description == "Tool: noop"
