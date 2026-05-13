"""
Spark - A lightweight Python agent framework.
"""

__version__ = "0.1.0"

from spark.agent import Agent
from spark.tool import Tool, tool
from spark.schema import build_tool_schema, build_parameters_schema

# Export tools module
from spark import tools

__all__ = [
    "Agent",
    "Tool",
    "tool",
    "build_tool_schema",
    "build_parameters_schema",
    "tools",
]
