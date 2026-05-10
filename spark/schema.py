"""
Spark Schema - Tool parameter schema generation for OpenAI function calling.
"""

import inspect
from typing import Any, Union, get_args, get_origin, get_type_hints

from spark.tool import Tool


def build_parameters_schema(func: callable) -> dict:
    """
    Generate OpenAI function calling parameter schema from function signature.

    Args:
        func: The function to generate schema for

    Returns:
        A JSON Schema compatible dict

    Example:
        @tool
        def search(query: str, limit: int = 10) -> str:
            '''Search the web'''
            ...

        # Generates:
        {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "default": 10}
            },
            "required": ["query"]
        }
    """
    hints = _get_type_hints_safe(func)
    sig = inspect.signature(func)

    properties = {}
    required = []

    for name, param in sig.parameters.items():
        if name == "self":
            continue

        prop = _type_to_schema(hints.get(name, str))
        if param.default is inspect.Parameter.empty:
            required.append(name)
        else:
            prop["default"] = param.default

        properties[name] = prop

    schema = {
        "type": "object",
        "properties": properties,
    }
    if required:
        schema["required"] = required

    return schema


def _get_type_hints_safe(func: callable) -> dict:
    """Get type hints, handling potential errors."""
    try:
        # Pass the function's global namespace for resolving forward references
        return get_type_hints(func, globalns=func.__globals__)
    except Exception:
        return {}


def _type_to_schema(python_type: type) -> dict:
    """
    Map Python type to JSON Schema type.

    Supports basic types and generic types like list[str], Optional[str].
    """
    origin = get_origin(python_type)

    # Handle Optional[T] (Union[T, None])
    if origin is Union:
        args = get_args(python_type)
        non_none_args = [a for a in args if a is not type(None)]
        if len(non_none_args) == 1:
            # It's Optional[T]
            return _type_to_schema(non_none_args[0])
        # Multiple union types, use first
        return _type_to_schema(non_none_args[0]) if non_none_args else {"type": "string"}

    # Handle generic types
    if origin is list or origin is list:
        args = get_args(python_type)
        if args:
            return {
                "type": "array",
                "items": _type_to_schema(args[0])
            }
        return {"type": "array"}

    if origin is dict or origin is dict:
        args = get_args(python_type)
        if args and len(args) >= 2:
            return {
                "type": "object",
                "additionalProperties": _type_to_schema(args[1])
            }
        return {"type": "object"}

    # Handle basic types
    type_map = {
        str: {"type": "string"},
        int: {"type": "integer"},
        float: {"type": "number"},
        bool: {"type": "boolean"},
        list: {"type": "array"},
        dict: {"type": "object"},
        Any: {"type": "object"},
    }

    return type_map.get(python_type, {"type": "string"})


def build_tool_schema(tools: list[Tool]) -> list[dict]:
    """
    Convert a list of Tools to OpenAI tools parameter format.

    Args:
        tools: List of Tool objects

    Returns:
        List of tool schemas in OpenAI format
    """
    return [
        {
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": build_parameters_schema(tool.func),
            }
        }
        for tool in tools
    ]
