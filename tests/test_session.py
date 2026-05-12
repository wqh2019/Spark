# tests/test_session.py
"""Tests for session management."""

import pytest
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
