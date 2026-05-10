"""
Tests for Schema generation.
"""

from typing import Optional

from spark.schema import _type_to_schema, build_parameters_schema, build_tool_schema
from spark.tool import tool


class TestBuildParametersSchema:
    """Tests for build_parameters_schema function."""

    def test_simple_function(self):
        """Test schema generation for simple function."""
        def func(query: str) -> str:
            """A simple function."""
            return query

        schema = build_parameters_schema(func)
        assert schema["type"] == "object"
        assert schema["properties"]["query"]["type"] == "string"
        assert schema["required"] == ["query"]

    def test_function_with_default(self):
        """Test schema generation with default values."""
        def func(query: str, limit: int = 10) -> str:
            """Function with default."""
            return query

        schema = build_parameters_schema(func)
        assert schema["properties"]["limit"]["type"] == "integer"
        assert schema["properties"]["limit"]["default"] == 10
        assert "limit" not in schema["required"]
        assert schema["required"] == ["query"]

    def test_multiple_types(self):
        """Test schema generation for various types."""
        def func(
            text: str,
            count: int,
            ratio: float,
            flag: bool,
            items: list,
            data: dict,
        ) -> str:
            """Function with multiple types."""
            return text

        schema = build_parameters_schema(func)
        assert schema["properties"]["text"]["type"] == "string"
        assert schema["properties"]["count"]["type"] == "integer"
        assert schema["properties"]["ratio"]["type"] == "number"
        assert schema["properties"]["flag"]["type"] == "boolean"
        assert schema["properties"]["items"]["type"] == "array"
        assert schema["properties"]["data"]["type"] == "object"

    def test_optional_type(self):
        """Test schema generation for Optional types."""
        def func(query: str, limit: Optional[int] = None) -> str:
            """Function with Optional type."""
            return query

        schema = build_parameters_schema(func)
        # Optional[int] should map to integer
        assert schema["properties"]["limit"]["type"] == "integer"

    def test_list_generic(self):
        """Test schema generation for list[str] type."""
        def func(items: list[str]) -> str:
            """Function with list[str] type."""
            return str(items)

        schema = build_parameters_schema(func)
        assert schema["properties"]["items"]["type"] == "array"
        assert schema["properties"]["items"]["items"]["type"] == "string"


class TestBuildToolSchema:
    """Tests for build_tool_schema function."""

    def test_single_tool(self):
        """Test schema generation for single tool."""
        @tool
        def search(query: str) -> str:
            """Search the web."""
            return query

        schemas = build_tool_schema([search])
        assert len(schemas) == 1
        assert schemas[0]["type"] == "function"
        assert schemas[0]["function"]["name"] == "search"
        assert schemas[0]["function"]["description"] == "Search the web."
        assert "parameters" in schemas[0]["function"]

    def test_multiple_tools(self):
        """Test schema generation for multiple tools."""
        @tool
        def search(query: str) -> str:
            """Search the web."""
            return query

        @tool
        def calculate(expression: str) -> str:
            """Calculate expression."""
            return expression

        schemas = build_tool_schema([search, calculate])
        assert len(schemas) == 2
        assert schemas[0]["function"]["name"] == "search"
        assert schemas[1]["function"]["name"] == "calculate"


class TestTypeToSchema:
    """Tests for _type_to_schema function."""

    def test_basic_types(self):
        """Test basic type mappings."""
        assert _type_to_schema(str) == {"type": "string"}
        assert _type_to_schema(int) == {"type": "integer"}
        assert _type_to_schema(float) == {"type": "number"}
        assert _type_to_schema(bool) == {"type": "boolean"}
        assert _type_to_schema(list) == {"type": "array"}
        assert _type_to_schema(dict) == {"type": "object"}

    def test_unknown_type_defaults_to_string(self):
        """Test unknown types default to string."""
        class CustomType:
            pass

        assert _type_to_schema(CustomType) == {"type": "string"}
