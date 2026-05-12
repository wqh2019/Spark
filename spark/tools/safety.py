# spark/tools/safety.py
"""Safety module for tool execution."""

from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class SafetyConfig:
    """Configuration for safety checks."""
    allowed_paths: list[str] = field(default_factory=list)
    blocked_commands: list[str] = field(default_factory=lambda: [
        "rm -rf /",
        "rm -rf /*",
        "sudo",
        "mkfs",
        "dd if=/dev/zero",
        "dd if=/dev/urandom",
        "> /dev/sda",
        "chmod -R 777 /",
        "chown -R",
        ":(){ :|:& };:",
    ])
    max_file_size: int = 10 * 1024 * 1024  # 10MB
    blocked_paths: list[str] = field(default_factory=lambda: [
        "/etc/passwd",
        "/etc/shadow",
        "/etc/ssh",
        "/root/.ssh",
    ])


class SafetyChecker:
    """Performs safety checks for tool operations."""

    def __init__(self, config: SafetyConfig | None = None):
        self.config = config or SafetyConfig()

    def check_path(self, path: str) -> tuple[bool, str]:
        """
        Check if a path is allowed for access.

        Returns:
            (is_allowed, error_message)
        """
        resolved = Path(path).resolve()

        # Check blocked system paths (check both original path and resolved path)
        for blocked in self.config.blocked_paths:
            if path.startswith(blocked) or str(resolved).startswith(blocked):
                return (False, f"Access to system path '{blocked}' is blocked")

        # If no whitelist, allow all (except blocked)
        if not self.config.allowed_paths:
            return (True, "")

        # Check against whitelist
        for allowed in self.config.allowed_paths:
            allowed_resolved = Path(allowed).resolve()
            try:
                resolved.relative_to(allowed_resolved)
                return (True, "")
            except ValueError:
                continue

        return (False, f"Path '{path}' is not in allowed paths")

    def check_command(self, command: str) -> tuple[bool, str]:
        """
        Check if a command is allowed to execute.

        Returns:
            (is_allowed, error_message)
        """
        for blocked in self.config.blocked_commands:
            if blocked in command:
                return (False, f"Command contains blocked pattern: '{blocked}'")

        return (True, "")


class SafetyHook:
    """Base class for user-defined safety hooks."""

    def on_read_file(self, path: str) -> tuple[bool, str]:
        """Called before reading a file. Return (allow, message)."""
        return (True, "")

    def on_write_file(self, path: str, content: str) -> tuple[bool, str]:
        """Called before writing a file. Return (allow, message)."""
        return (True, "")

    def on_edit_file(self, path: str) -> tuple[bool, str]:
        """Called before editing a file. Return (allow, message)."""
        return (True, "")

    def on_run_command(self, command: str) -> tuple[bool, str]:
        """Called before running a command. Return (allow, message)."""
        return (True, "")
