# tests/test_tools/test_file.py
import os
import tempfile
import pytest
from spark.tools.file import read_file


class TestReadFile:
    def test_read_file_success(self):
        """Should read file content successfully."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("Hello, World!\nLine 2\nLine 3")
            temp_path = f.name

        try:
            result = read_file(temp_path)
            assert "Hello, World!" in result
            assert "Line 2" in result
        finally:
            os.unlink(temp_path)

    def test_read_file_with_limit(self):
        """Should read only specified number of lines."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("Line 1\nLine 2\nLine 3\nLine 4\nLine 5")
            temp_path = f.name

        try:
            result = read_file(temp_path, limit=2)
            lines = result.strip().split('\n')
            assert len(lines) == 2
        finally:
            os.unlink(temp_path)

    def test_read_file_with_offset(self):
        """Should read from specified offset."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.txt', delete=False) as f:
            f.write("Line 1\nLine 2\nLine 3\nLine 4\nLine 5")
            temp_path = f.name

        try:
            result = read_file(temp_path, offset=2, limit=2)
            assert "Line 3" in result
            assert "Line 4" in result
            assert "Line 1" not in result
        finally:
            os.unlink(temp_path)

    def test_read_file_not_found(self):
        """Should return error for non-existent file."""
        result = read_file("/nonexistent/path/file.txt")
        assert result.startswith("Error:")
        assert "not found" in result.lower()

    def test_read_file_is_directory(self):
        """Should return error when path is a directory."""
        result = read_file(tempfile.gettempdir())
        assert result.startswith("Error:")
        assert "directory" in result.lower() or "not a file" in result.lower()
