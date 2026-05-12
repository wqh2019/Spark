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
        self._messages.append({"role": role, "content": content})

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

    def __len__(self) -> int:
        """Return number of messages in history."""
        return len(self._messages)
