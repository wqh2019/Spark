# tests/test_tools/test_shell.py
import pytest
from spark.tools.shell import run_command


class TestRunCommand:
    def test_run_command_echo(self):
        """Should execute echo command and return output."""
        result = run_command("echo 'Hello, World!'")
        assert "Hello, World!" in result

    def test_run_command_with_exit_code(self):
        """Should show exit code for failed commands."""
        result = run_command("ls /nonexistent_directory_12345")
        # Should complete (ls returns non-zero but command runs)
        assert result  # Should have some output

    def test_run_command_timeout(self):
        """Should handle timeout for long-running commands."""
        # Using a short timeout for a sleep command
        result = run_command("sleep 5", timeout=100)  # 100ms timeout
        assert "timeout" in result.lower() or "timed out" in result.lower()

    def test_run_command_empty(self):
        """Should handle empty command."""
        result = run_command("")
        assert "Error" in result or "empty" in result.lower()
