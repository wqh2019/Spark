# tests/test_session.py
"""Tests for session management."""

import pytest
from pathlib import Path
from tempfile import TemporaryDirectory
from spark.server.session import SessionManager


class TestSessionManager:
    """Test suite for SessionManager."""

    def test_create_session(self):
        """Test creating a new session."""
        manager = SessionManager()
        session_id = "test-session-1"

        history = manager.get_history(session_id)
        assert history == []

    def test_add_message_to_session(self):
        """Test adding messages to a session."""
        manager = SessionManager()
        session_id = "test-session-2"

        manager.add_message(session_id, "user", "Hello")
        manager.add_message(session_id, "assistant", "Hi!")

        history = manager.get_history(session_id)
        assert len(history) == 2

    def test_clear_session(self):
        """Test clearing a session."""
        manager = SessionManager()
        session_id = "test-session-3"

        manager.add_message(session_id, "user", "Test")
        manager.clear(session_id)

        assert len(manager.get_history(session_id)) == 0

    def test_multiple_sessions_isolated(self):
        """Test that multiple sessions are isolated."""
        manager = SessionManager()

        manager.add_message("session-1", "user", "Hello 1")
        manager.add_message("session-2", "user", "Hello 2")

        assert len(manager.get_history("session-1")) == 1
        assert len(manager.get_history("session-2")) == 1
        assert manager.get_history("session-1")[0]["content"] == "Hello 1"


class TestSessionManagerPersistence:
    """Test suite for SessionManager with file persistence."""

    @pytest.fixture
    def manager(self):
        """Create a SessionManager with a temp directory."""
        with TemporaryDirectory() as tmpdir:
            yield SessionManager(sessions_dir=Path(tmpdir))

    def test_persistence_enabled_with_dir(self, manager: SessionManager):
        """Test that persistence is enabled when sessions_dir is provided."""
        assert manager._store is not None

    def test_message_persists_to_disk(self, manager: SessionManager):
        """Test that adding a message writes to disk."""
        manager.add_message("persist-test", "user", "Hello")

        # Check file was created
        store = manager._store
        messages = store.load_messages("persist-test")
        assert len(messages) == 1
        assert messages[0]["role"] == "user"
        assert messages[0]["content"] == "Hello"

    def test_session_survives_manager_recreation(self):
        """Test that sessions persist across manager instances."""
        with TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir)

            # Create first manager and add a message
            manager1 = SessionManager(sessions_dir=sessions_dir)
            manager1.add_message("survive-test", "user", "Persistent message")

            # Create second manager with same directory
            manager2 = SessionManager(sessions_dir=sessions_dir)

            # Session should be loaded from disk
            history = manager2.get_history("survive-test")
            assert len(history) == 1
            assert history[0]["content"] == "Persistent message"

    def test_meta_persists_to_disk(self, manager: SessionManager):
        """Test that metadata is persisted."""
        manager.add_message("meta-test", "user", "This is a test message for title")

        store = manager._store
        meta = store.load_meta("meta-test")
        assert meta is not None
        assert "This is a test message" in meta["title"]

    def test_list_sessions_from_disk(self):
        """Test that list_sessions reads from disk."""
        with TemporaryDirectory() as tmpdir:
            sessions_dir = Path(tmpdir)

            # Create first manager and add sessions
            manager1 = SessionManager(sessions_dir=sessions_dir)
            manager1.add_message("session-a", "user", "Message A")
            manager1.add_message("session-b", "user", "Message B")

            # Create new manager
            manager2 = SessionManager(sessions_dir=sessions_dir)
            sessions = manager2.list_sessions()

            session_ids = [s["session_id"] for s in sessions]
            assert "session-a" in session_ids
            assert "session-b" in session_ids

    def test_delete_removes_from_disk(self, manager: SessionManager):
        """Test that delete removes files from disk."""
        manager.add_message("delete-test", "user", "To be deleted")
        manager.delete("delete-test")

        store = manager._store
        assert store.load_meta("delete-test") is None
        assert store.load_messages("delete-test") == []

    def test_clear_persists_to_disk(self, manager: SessionManager):
        """Test that clear truncates the messages file."""
        manager.add_message("clear-test", "user", "Message 1")
        manager.add_message("clear-test", "assistant", "Response")
        manager.clear("clear-test")

        store = manager._store
        messages = store.load_messages("clear-test")
        assert messages == []

    def test_created_at_set_once(self, manager: SessionManager):
        """Test that created_at is set once and not overwritten."""
        manager.add_message("created-test", "user", "First")

        meta1 = manager._store.load_meta("created-test")
        created_at = meta1["created_at"]

        # Add another message
        manager.add_message("created-test", "user", "Second")

        meta2 = manager._store.load_meta("created-test")
        assert meta2["created_at"] == created_at

    def test_backwards_compatible_no_dir(self):
        """Test that SessionManager works without sessions_dir (in-memory only)."""
        manager = SessionManager()  # No sessions_dir
        assert manager._store is None

        manager.add_message("memory-only", "user", "Test")
        history = manager.get_history("memory-only")
        assert len(history) == 1
