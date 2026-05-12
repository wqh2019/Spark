# spark/tools/search.py
"""Search and find tools."""

import re
from pathlib import Path

from spark.tool import tool


@tool
def glob_files(pattern: str, path: str = ".") -> str:
    """
    Find files matching a glob pattern.

    Args:
        pattern: Glob pattern (e.g., "**/*.py", "*.txt")
        path: Directory to search in (defaults to current directory)

    Returns:
        List of matching file paths, or message if none found
    """
    search_path = Path(path)

    if not search_path.exists():
        return f"Error: Path not found: {path}"

    if not search_path.is_dir():
        return f"Error: Path is not a directory: {path}"

    try:
        # Use recursive glob for ** patterns - filter to files only
        matches = [m for m in search_path.glob(pattern) if m.is_file()]

        if not matches:
            return f"No files found matching pattern: {pattern}"

        # Sort and format results
        matches.sort(key=lambda p: str(p))
        result_lines = [f"Found {len(matches)} file(s):"]
        for match in matches:
            rel_path = match.relative_to(search_path)
            result_lines.append(f"  {rel_path}")

        return '\n'.join(result_lines)

    except PermissionError:
        return f"Error: Permission denied accessing: {path}"
    except Exception as e:
        return f"Error: {str(e)}"


@tool
def grep_content(pattern: str, path: str = ".", file_pattern: str = "*") -> str:
    """
    Search for a regex pattern in files.

    Args:
        pattern: Regular expression pattern to search for
        path: Directory to search in (defaults to current directory)
        file_pattern: Glob pattern to filter files (defaults to all files)

    Returns:
        Matching lines with file paths and line numbers, or message if none found
    """
    search_path = Path(path)

    if not search_path.exists():
        return f"Error: Path not found: {path}"

    try:
        regex = re.compile(pattern)
    except re.error as e:
        return f"Error: Invalid regex pattern: {e}"

    try:
        matches = []
        files_searched = 0

        for file_path in search_path.rglob(file_pattern):
            if not file_path.is_file():
                continue

            # Skip binary files and common non-text directories
            if any(part in file_path.parts for part in ['.git', '__pycache__', 'node_modules', '.venv']):
                continue

            files_searched += 1

            try:
                with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                    for line_num, line in enumerate(f, 1):
                        if regex.search(line):
                            rel_path = file_path.relative_to(search_path)
                            matches.append(f"{rel_path}:{line_num}: {line.rstrip()}")
            except Exception:
                continue

        if not matches:
            return f"No matches found for pattern '{pattern}' in {files_searched} file(s)"

        result_lines = [f"Found {len(matches)} match(es) in {files_searched} file(s):"]
        result_lines.extend(matches)

        return '\n'.join(result_lines)

    except Exception as e:
        return f"Error: {str(e)}"
