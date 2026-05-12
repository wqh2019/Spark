# spark/tools/search.py
"""Search and find tools."""

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
