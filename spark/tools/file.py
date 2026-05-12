# spark/tools/file.py
"""File operation tools."""

from pathlib import Path

from spark.tool import tool


@tool
def read_file(file_path: str, offset: int = 0, limit: int = 2000) -> str:
    """
    Read file content with optional pagination.

    Args:
        file_path: Absolute or relative path to the file
        offset: Line number to start reading from (0-indexed)
        limit: Maximum number of lines to read

    Returns:
        File content as string, or error message
    """
    path = Path(file_path)

    if not path.exists():
        return f"Error: File not found: {file_path}"

    if path.is_dir():
        return f"Error: Path is a directory, not a file: {file_path}"

    try:
        with open(path, 'r', encoding='utf-8') as f:
            # Use lazy iteration for memory efficiency
            result_lines = []
            for i, line in enumerate(f):
                if i < offset:
                    continue
                if i >= offset + limit:
                    break
                result_lines.append(f"{i + 1:6}\t{line.rstrip()}")

        return '\n'.join(result_lines)

    except UnicodeDecodeError:
        return f"Error: Cannot read file as text (binary or unsupported encoding): {file_path}"
    except PermissionError:
        return f"Error: Permission denied: {file_path}"
    except Exception as e:
        return f"Error: {str(e)}"
