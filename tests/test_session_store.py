# tests/test_session_store.py
"""Tests for session file storage."""

import json
import pytest
from pathlib import Path
from tempfile import TemporaryDirectory

from spark.server.session_store import SessionStore


class TestSessionStore:
    """Test suite for SessionStore."""

    @pytest.fixture
    def store(self):
        """Create a SessionStore with a temp directory."""
        with TemporaryDirectory() as tmpdir:
            yield SessionStore(Path(tmpdir))

    def test_init_creates_directory(self):
        """Test that SessionStore creates the sessions directory."""
        with TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir) / "sessions"
            SessionStore(sessions_dir)
            assert sessions_dir.exists()

    def test_save_meta(self, store: SessionStore):
        """Test saving session metadata."""
        meta = {
            "session_id": "test-123",
            "title": "Test Session",
            "created_at": "2024-01-01T10:00:00",
            "updated_at": "2024-01-01T10:05:00",
            "message_count": 2,
        }
        store.save_meta("test-123", meta)

        meta_path = store.sessions_dir / "test-123" / "meta.json"
        assert meta_path.exists()

        with open(meta_path, encoding="utf-8") as f:
            loaded = json.load(f)
        assert loaded == meta

    def test_load_meta(self, store: SessionStore):
        """Test loading session metadata."""
        meta = {
            "session_id": "test-456",
            "title": "Another Session",
            "created_at": "2024-01-02T10:00:00",
            "updated_at": "2024-01-02T10:05:00",
            "message_count": 5,
        }
        store.save_meta("test-456", meta)

        loaded = store.load_meta("test-456")
        assert loaded == meta

    def test_load_meta_missing_returns_none(self, store: SessionStore):
        """Test that loading missing metadata returns None."""
        result = store.load_meta("nonexistent")
        assert result is None

    def test_append_message(self, store: SessionStore):
        """Test appending a message to the JSONL file."""
        msg = {"role": "user", "content": "Hello", "timestamp": "2024-01-01T10:00:00"}
        store.append_message("test-789", msg)

        messages_path = store.sessions_dir / "test-789" / "messages.jsonl"
        assert messages_path.exists()

        with open(messages_path, encoding="utf-8") as f:
            lines = f.readlines()
        assert len(lines) == 1
        assert json.loads(lines[0]) == msg

    def test_append_multiple_messages(self, store: SessionStore):
        """Test appending multiple messages."""
        messages = [
            {"role": "user", "content": "Hi", "timestamp": "2024-01-01T10:00:00"},
            {"role": "assistant", "content": "Hello!", "timestamp": "2024-01-01T10:00:05"},
        ]
        for msg in messages:
            store.append_message("test-multi", msg)

        loaded = store.load_messages("test-multi")
        assert len(loaded) == 2
        assert loaded[0]["content"] == "Hi"
        assert loaded[1]["content"] == "Hello!"

    def test_load_messages_empty(self, store: SessionStore):
        """Test loading messages from a nonexistent session."""
        result = store.load_messages("nonexistent")
        assert result == []

    def test_load_messages_skip_invalid_lines(self, store: SessionStore):
        """Test that loading messages skips invalid JSON lines."""
        msg = {"role": "user", "content": "Valid", "timestamp": "2024-01-01T10:00:00"}
        store.append_message("test-invalid", msg)

        # Append invalid line manually
        messages_path = store.sessions_dir / "test-invalid" / "messages.jsonl"
        with open(messages_path, "a", encoding="utf-8") as f:
            f.write("invalid json line\n")
            f.write('{"role": "assistant", "content": "Also valid", "timestamp": "2024-01-01T10:01:00"}\n')

        loaded = store.load_messages("test-invalid")
        assert len(loaded) == 2
        assert loaded[0]["content"] == "Valid"
        assert loaded[1]["content"] == "Also valid"

    def test_clear_messages(self, store: SessionStore):
        """Test clearing messages from a session."""
        store.append_message("test-clear", {"role": "user", "content": "Test"})
        store.clear_messages("test-clear")

        messages_path = store.sessions_dir / "test-clear" / "messages.jsonl"
        assert messages_path.exists()
        assert store.load_messages("test-clear") == []

    def test_delete_session(self, store: SessionStore):
        """Test deleting a session directory."""
        store.save_meta("test-delete", {"session_id": "test-delete", "title": "To Delete"})
        store.append_message("test-delete", {"role": "user", "content": "Test"})

        store.delete_session("test-delete")

        session_dir = store.sessions_dir / "test-delete"
        assert not session_dir.exists()

    def test_delete_nonexistent_session(self, store: SessionStore):
        """Test that deleting a nonexistent session doesn't raise."""
        store.delete_session("nonexistent")  # Should not raise

    def test_list_session_ids(self, store: SessionStore):
        """Test listing all session IDs from disk."""
        store.save_meta("session-a", {"session_id": "session-a", "title": "A"})
        store.save_meta("session-b", {"session_id": "session-b", "title": "B"})
        # Create a directory without meta.json (should be ignored)
        (store.sessions_dir / "incomplete").mkdir()

        ids = store.list_session_ids()
        assert set(ids) == {"session-a", "session-b"}
