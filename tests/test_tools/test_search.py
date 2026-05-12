# tests/test_tools/test_search.py
import os
import tempfile
import pytest
from spark.tools.search import glob_files, grep_content


class TestGlobFiles:
    def test_glob_find_python_files(self):
        """Should find Python files matching pattern."""
        with tempfile.TemporaryDirectory() as tmpdir:
            # Create nested structure
            os.makedirs(os.path.join(tmpdir, "src"))
            open(os.path.join(tmpdir, "main.py"), 'w').close()
            open(os.path.join(tmpdir, "src", "utils.py"), 'w').close()
            open(os.path.join(tmpdir, "src", "helper.py"), 'w').close()
            open(os.path.join(tmpdir, "readme.txt"), 'w').close()

            result = glob_files("**/*.py", tmpdir)

            assert "main.py" in result
            assert "utils.py" in result
            assert "helper.py" in result
            assert "readme.txt" not in result

    def test_glob_no_matches(self):
        """Should return message when no matches found."""
        with tempfile.TemporaryDirectory() as tmpdir:
            result = glob_files("*.nonexistent", tmpdir)
            assert "no files found" in result.lower() or "0 files" in result.lower()

    def test_glob_simple_pattern(self):
        """Should match files with simple pattern."""
        with tempfile.TemporaryDirectory() as tmpdir:
            open(os.path.join(tmpdir, "test1.py"), 'w').close()
            open(os.path.join(tmpdir, "test2.py"), 'w').close()
            open(os.path.join(tmpdir, "other.txt"), 'w').close()

            result = glob_files("*.py", tmpdir)

            assert "test1.py" in result
            assert "test2.py" in result
            assert "other.txt" not in result

    def test_glob_path_not_found(self):
        """Should return error for non-existent path."""
        result = glob_files("*.py", "/nonexistent/directory")
        assert "Error" in result
        assert "not found" in result.lower()

    def test_glob_path_is_file(self):
        """Should return error when path is a file."""
        with tempfile.NamedTemporaryFile(delete=False) as f:
            temp_path = f.name

        try:
            result = glob_files("*.py", temp_path)
            assert "Error" in result
            assert "not a directory" in result.lower()
        finally:
            os.unlink(temp_path)


class TestGrepContent:
    def test_grep_find_pattern(self):
        """Should find lines matching pattern."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "test.py")
            with open(file_path, 'w') as f:
                f.write("def hello():\n    print('hello')\n\ndef world():\n    print('world')\n")

            result = grep_content("def", tmpdir, "*.py")

            assert "def hello():" in result
            assert "def world():" in result

    def test_grep_show_line_numbers(self):
        """Should show line numbers in results."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "test.txt")
            with open(file_path, 'w') as f:
                f.write("line 1\nline 2\npattern here\nline 4\n")

            result = grep_content("pattern", tmpdir)

            assert "pattern here" in result
            assert "3" in result  # Line number

    def test_grep_no_matches(self):
        """Should return message when no matches."""
        with tempfile.TemporaryDirectory() as tmpdir:
            file_path = os.path.join(tmpdir, "test.txt")
            with open(file_path, 'w') as f:
                f.write("some content\n")

            result = grep_content("nonexistent_pattern", tmpdir)

            assert "no matches" in result.lower() or "0 matches" in result.lower()

    def test_grep_file_pattern_filter(self):
        """Should only search files matching file_pattern."""
        with tempfile.TemporaryDirectory() as tmpdir:
            py_file = os.path.join(tmpdir, "test.py")
            txt_file = os.path.join(tmpdir, "test.txt")

            with open(py_file, 'w') as f:
                f.write("pattern_in_py\n")
            with open(txt_file, 'w') as f:
                f.write("pattern_in_txt\n")

            result = grep_content("pattern", tmpdir, "*.py")

            assert "pattern_in_py" in result
            assert "pattern_in_txt" not in result
