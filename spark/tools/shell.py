"""Shell command execution tool."""

import subprocess
from typing import Any

from spark.tool import tool


@tool
def run_command(command: str, timeout: int = 120000) -> str:
    """
    Execute a shell command and return its output.

    Args:
        command: The shell command to execute
        timeout: Timeout in milliseconds (default: 120000ms = 2 minutes)

    Returns:
        Command output (stdout and stderr), or error message
    """
    if not command or not command.strip():
        return "Error: Empty command"

    try:
        result = subprocess.run(
            command,
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout / 1000,  # Convert to seconds
        )

        output_parts = []

        if result.stdout:
            output_parts.append(result.stdout)

        if result.stderr:
            output_parts.append(f"STDERR:\n{result.stderr}")

        if result.returncode != 0:
            output_parts.append(f"Exit code: {result.returncode}")

        output = '\n'.join(output_parts).strip()

        return output if output else f"Command completed with exit code {result.returncode}"

    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout}ms"
    except Exception as e:
        return f"Error: {str(e)}"
