# spark/tools/__init__.py
"""
Spark Tools - Common tools for building AI assistants.

Usage:
    from spark.tools import get_all_tools
    agent = Agent(model="gpt-4", tools=get_all_tools())
"""

from typing import Any

from spark.tool import Tool
from spark.tools.safety import SafetyConfig, SafetyChecker, SafetyHook
from spark.tools.file import read_file, write_file, edit_file, list_dir
from spark.tools.search import glob_files, grep_content
from spark.tools.shell import run_command


__all__ = [
    # Tools
    "read_file",
    "write_file",
    "edit_file",
    "list_dir",
    "glob_files",
    "grep_content",
    "run_command",
    # Safety
    "SafetyConfig",
    "SafetyChecker",
    "SafetyHook",
    # Helpers
    "get_all_tools",
]


def get_all_tools(
    safety_config: SafetyConfig | None = None,
    hook: SafetyHook | None = None,
) -> list[Tool]:
    """
    Get all available tool instances.

    Args:
        safety_config: Optional safety configuration for path/command restrictions
        hook: Optional user-defined hook for custom safety checks

    Returns:
        List of Tool objects ready to use with Agent
    """
    # Note: safety_config and hook are stored for future integration
    # Currently tools return basic implementations without safety wrapping
    # TODO: Wrap tools with safety checks in future iteration

    return [
        read_file,
        write_file,
        edit_file,
        list_dir,
        glob_files,
        grep_content,
        run_command,
    ]
