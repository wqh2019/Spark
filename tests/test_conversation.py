# tests/test_conversation.py
"""Tests for conversation memory."""

import pytest
from spark.memory import ConversationMemory


class TestConversationMemory:
    """Test suite for ConversationMemory."""

    def test_add_and_get_messages(self):
        """Test adding and retrieving messages."""
        memory = ConversationMemory(max_messages=10)

        memory.add_message("user", "Hello")
        memory.add_message("assistant", "Hi there!")

        history = memory.get_messages()
        assert len(history) == 2
        assert history[0] == {"role": "user", "content": "Hello"}
        assert history[1] == {"role": "assistant", "content": "Hi there!"}

    def test_max_messages_limit(self):
        """Test that messages are trimmed when exceeding limit."""
        memory = ConversationMemory(max_messages=3)

        for i in range(5):
            memory.add_message("user", f"Message {i}")

        history = memory.get_messages()
        assert len(history) == 3
        assert history[0]["content"] == "Message 2"
        assert history[2]["content"] == "Message 4"

    def test_clear_messages(self):
        """Test clearing conversation history."""
        memory = ConversationMemory()
        memory.add_message("user", "Hello")

        memory.clear()
        assert len(memory.get_messages()) == 0

    def test_get_messages_for_api(self):
        """Test getting messages in OpenAI API format."""
        memory = ConversationMemory()
        memory.add_message("user", "Hi")
        memory.add_message("assistant", "Hello!")

        messages = memory.get_messages()
        assert messages == [
            {"role": "user", "content": "Hi"},
            {"role": "assistant", "content": "Hello!"},
        ]

    def test_set_messages(self):
        """Test setting messages from external source."""
        memory = ConversationMemory(max_messages=10)

        messages = [
            {"role": "user", "content": "Hello", "timestamp": "2024-01-01T10:00:00"},
            {"role": "assistant", "content": "Hi!", "timestamp": "2024-01-01T10:00:05"},
        ]
        memory.set_messages(messages)

        loaded = memory.get_messages()
        assert len(loaded) == 2
        assert loaded[0]["content"] == "Hello"
        assert loaded[1]["content"] == "Hi!"

    def test_set_messages_respects_max_limit(self):
        """Test that set_messages respects max_messages limit."""
        memory = ConversationMemory(max_messages=3)

        messages = [
            {"role": "user", "content": f"Msg {i}", "timestamp": f"2024-01-01T10:0{i}:00"}
            for i in range(5)
        ]
        memory.set_messages(messages)

        loaded = memory.get_messages()
        assert len(loaded) == 3
        # Should keep the most recent messages
        assert loaded[0]["content"] == "Msg 2"
        assert loaded[2]["content"] == "Msg 4"
