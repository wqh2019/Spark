# tests/test_tools/test_file.py
import os
import tempfile
import pytest
from spark.tools.file import read_file, write_file, edit_file, list_dir


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


class TestWriteFile:
    def test_write_file_create(self):
        """Should create a new file and write content."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "new_file.txt")
            result = write_file(file_path, "Hello, World!")

            assert result.startswith("Success") or result == "Success" or "wrote" in result.lower()
            assert os.path.exists(file_path)

            with open(file_path, 'r') as f:
                assert f.read() == "Hello, World!"

    def test_write_file_overwrite(self):
        """Should overwrite existing file."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "existing.txt")
            write_file(file_path, "Original content")
            result = write_file(file_path, "New content")

            with open(file_path, 'r') as f:
                assert f.read() == "New content"

    def test_write_file_create_directories(self):
        """Should create parent directories if they don't exist."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "subdir", "nested", "file.txt")
            result = write_file(file_path, "Nested content")

            assert os.path.exists(file_path)
            with open(file_path, 'r') as f:
                assert f.read() == "Nested content"


class TestEditFile:
    def test_edit_file_single_replace(self):
        """Should replace a single occurrence."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "edit.txt")
            write_file(file_path, "Hello World\nGoodbye Everyone")

            result = edit_file(file_path, "World", "Universe")

            with open(file_path, 'r') as f:
                content = f.read()
            assert content == "Hello Universe\nGoodbye Everyone"

    def test_edit_file_multiple_occurrences_error(self):
        """Should error when old_string matches multiple times."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "edit.txt")
            write_file(file_path, "foo bar foo")

            result = edit_file(file_path, "foo", "baz")
            assert "Error" in result
            assert "occurrences" in result.lower()

    def test_edit_file_replace_all(self):
        """Should replace all occurrences when replace_all is True."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "edit.txt")
            write_file(file_path, "foo bar foo baz foo")

            result = edit_file(file_path, "foo", "qux", replace_all=True)

            with open(file_path, 'r') as f:
                content = f.read()
            assert content == "qux bar qux baz qux"

    def test_edit_file_not_found(self):
        """Should error when old_string is not found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "edit.txt")
            write_file(file_path, "Some content")

            result = edit_file(file_path, "nonexistent", "replacement")
            assert "Error" in result
            assert "not found" in result.lower()

    def test_edit_file_file_not_exist(self):
        """Should error when the file does not exist."""
        result = edit_file("/nonexistent/path/file.txt", "old", "new")
        assert "Error" in result
        assert "not found" in result.lower()

    def test_edit_file_is_directory(self):
        """Should error when path is a directory."""
        result = edit_file(tempfile.gettempdir(), "old", "new")
        assert "Error" in result
        assert "directory" in result.lower() or "not a file" in result.lower()

    def test_edit_file_empty_string(self):
        """Should error when old_string is empty."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "edit.txt")
            write_file(file_path, "Some content")

            result = edit_file(file_path, "", "replacement")
            assert "Error" in result
            assert "empty" in result.lower()


class TestListDir:
    def test_list_dir_basic(self):
        """Should list directory contents."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create some files and directories
            os.makedirs(os.path.join(tmpdir, "subdir"))
            open(os.path.join(tmpdir, "file1.txt"), 'w').close()
            open(os.path.join(tmpdir, "file2.py"), 'w').close()

            result = list_dir(tmpdir)

            assert "file1.txt" in result
            assert "file2.py" in result
            assert "subdir" in result

    def test_list_dir_nonexistent(self):
        """Should error for non-existent directory."""
        result = list_dir("/nonexistent/directory")
        assert "Error" in result

    def test_list_dir_file_path(self):
        """Should error when given a file path."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_path = f.name

        try:
            result = list_dir(temp_path)
            assert "Error" in result
        finally:
            os.unlink(temp_path)
