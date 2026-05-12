# tests/test_tools/test_safety.py
import pytest
from spark.tools.safety import SafetyConfig, SafetyChecker


class TestSafetyConfig:
    def test_default_config(self):
        """Default config should allow all paths."""
        config = SafetyConfig()
        assert config.allowed_paths == []
        assert config.max_file_size == 10 * 1024 * 1024

    def test_custom_allowed_paths(self):
        """Custom allowed paths should be stored."""
        config = SafetyConfig(allowed_paths=["./src", "./tests"])
        assert config.allowed_paths == ["./src", "./tests"]


class TestSafetyChecker:
    def test_check_path_allow_all(self):
        """Empty allowed_paths should allow any path."""
        config = SafetyConfig()
        checker = SafetyChecker(config)
        ok, msg = checker.check_path("/any/path/file.txt")
        assert ok is True
        assert msg == ""

    def test_check_path_with_whitelist(self):
        """Should only allow paths within whitelist."""
        config = SafetyConfig(allowed_paths=["./src"])
        checker = SafetyChecker(config)
        ok, msg = checker.check_path("./src/main.py")
        assert ok is True

        ok, msg = checker.check_path("./other/file.py")
        assert ok is False
        assert "not in allowed paths" in msg

    def test_check_path_system_critical(self):
        """Should block system critical paths."""
        config = SafetyConfig()
        checker = SafetyChecker(config)
        ok, msg = checker.check_path("/etc/passwd")
        assert ok is False
        assert "system" in msg.lower()

    def test_check_command_blocked_commands(self):
        """Should block dangerous commands."""
        config = SafetyConfig()
        checker = SafetyChecker(config)
        ok, msg = checker.check_command("rm -rf /")
        assert ok is False

        ok, msg = checker.check_command("sudo rm something")
        assert ok is False

    def test_check_command_allowed(self):
        """Should allow safe commands."""
        config = SafetyConfig()
        checker = SafetyChecker(config)
        ok, msg = checker.check_command("ls -la")
        assert ok is True
