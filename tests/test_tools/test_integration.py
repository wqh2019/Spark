# tests/test_tools/test_integration.py
import pytest
from spark.tools import (
    read_file,
    write_file,
    edit_file,
    list_dir,
    glob_files,
    grep_content,
    run_command,
    get_all_tools,
    SafetyConfig,
    SafetyChecker,
    SafetyHook,
)


class TestModuleExports:
    def test_all_tools_exported(self):
        """All tools should be importable from spark.tools."""
        assert callable(read_file.run)
        assert callable(write_file.run)
        assert callable(edit_file.run)
        assert callable(list_dir.run)
        assert callable(glob_files.run)
        assert callable(grep_content.run)
        assert callable(run_command.run)

    def test_safety_classes_exported(self):
        """Safety classes should be importable."""
        config = SafetyConfig()
        assert config is not None

        checker = SafetyChecker(config)
        assert checker is not None

        hook = SafetyHook()
        assert hook is not None

    def test_get_all_tools_returns_list(self):
        """get_all_tools should return a list of Tools."""
        tools = get_all_tools()
        assert isinstance(tools, list)
        assert len(tools) >= 7  # At least 7 tools

        tool_names = [t.name for t in tools]
        assert "read_file" in tool_names
        assert "write_file" in tool_names
        assert "run_command" in tool_names
