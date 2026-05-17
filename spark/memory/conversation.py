# spark/memory/conversation.py
"""Conversation memory management."""

from dataclasses import dataclass, field


@dataclass
class ConversationMemory:
    """
    In-memory conversation history with sliding window.

    Args:
        max_messages: Maximum number of messages to keep.
    """

    max_messages: int = 50
    _messages: list[dict] = field(default_factory=list)

    def add_message(self, role: str, content: str) -> None:
        """
        Add a message to the conversation history.

        Args:
            role: Message role (user, assistant, system, tool)
            content: Message content
        """
        from datetime import datetime
        self._messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat(),
        })

        # Trim old messages if exceeds limit
        if len(self._messages) > self.max_messages:
            self._messages = self._messages[-self.max_messages:]

    def get_messages(self) -> list[dict]:
        """
        Get all messages in OpenAI API format.

        Returns:
            List of message dictionaries.
        """
        return self._messages.copy()

    def clear(self) -> None:
        """Clear all messages from history."""
        self._messages.clear()

    def set_messages(self, messages: list[dict]) -> None:
        """
        Set messages from an external source (e.g., loaded from disk).

        Applies the sliding window if messages exceed max_messages.

        Args:
            messages: List of message dictionaries.
        """
        if len(messages) > self.max_messages:
            self._messages = messages[-self.max_messages:]
        else:
            self._messages = list(messages)

    def __len__(self) -> int:
        """Return number of messages in history."""
        return len(self._messages)
