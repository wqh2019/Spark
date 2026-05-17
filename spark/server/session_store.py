# spark/server/session_store.py
"""File-based session storage using JSONL and JSON."""

import json
from pathlib import Path


class SessionStore:
    """
    Handles file-based session persistence.

    Directory structure:
        sessions_dir/
        ├── {session_id}/
        │   ├── meta.json         # Session metadata
        │   └── messages.jsonl    # Messages (append-only)
    """

    def __init__(self, sessions_dir: Path):
        """
        Initialize the session store.

        Args:
            sessions_dir: Root directory for session storage.
        """
        self.sessions_dir = Path(sessions_dir)
        self.sessions_dir.mkdir(parents=True, exist_ok=True)

    def _session_dir(self, session_id: str) -> Path:
        """Get the directory path for a session."""
        return self.sessions_dir / session_id

    def _meta_path(self, session_id: str) -> Path:
        """Get the metadata file path for a session."""
        return self._session_dir(session_id) / "meta.json"

    def _messages_path(self, session_id: str) -> Path:
        """Get the messages file path for a session."""
        return self._session_dir(session_id) / "messages.jsonl"

    def _ensure_session_dir(self, session_id: str) -> Path:
        """Ensure the session directory exists and return its path."""
        session_dir = self._session_dir(session_id)
        session_dir.mkdir(parents=True, exist_ok=True)
        return session_dir

    def save_meta(self, session_id: str, meta: dict) -> None:
        """
        Save session metadata to disk.

        Args:
            session_id: Session identifier.
            meta: Metadata dictionary.
        """
        self._ensure_session_dir(session_id)
        meta_path = self._meta_path(session_id)
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(meta, f, ensure_ascii=False, indent=2)

    def load_meta(self, session_id: str) -> dict | None:
        """
        Load session metadata from disk.

        Args:
            session_id: Session identifier.

        Returns:
            Metadata dictionary, or None if not found.
        """
        meta_path = self._meta_path(session_id)
        if not meta_path.exists():
            return None
        try:
            with open(meta_path, encoding="utf-8") as f:
                return json.load(f)
        except (json.JSONDecodeError, OSError):
            return None

    def append_message(self, session_id: str, message: dict) -> None:
        """
        Append a message to the session's JSONL file.

        Args:
            session_id: Session identifier.
            message: Message dictionary.
        """
        self._ensure_session_dir(session_id)
        messages_path = self._messages_path(session_id)
        with open(messages_path, "a", encoding="utf-8") as f:
            f.write(json.dumps(message, ensure_ascii=False) + "\n")

    def load_messages(self, session_id: str) -> list[dict]:
        """
        Load all messages from the session's JSONL file.

        Args:
            session_id: Session identifier.

        Returns:
            List of message dictionaries. Empty list if not found.
        """
        messages_path = self._messages_path(session_id)
        if not messages_path.exists():
            return []

        messages = []
        try:
            with open(messages_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        messages.append(json.loads(line))
                    except json.JSONDecodeError:
                        # Skip invalid lines
                        continue
        except OSError:
            return []

        return messages

    def clear_messages(self, session_id: str) -> None:
        """
        Clear all messages from a session.

        Args:
            session_id: Session identifier.
        """
        messages_path = self._messages_path(session_id)
        if messages_path.exists():
            # Truncate the file (keep it, but empty)
            with open(messages_path, "w", encoding="utf-8") as f:
                pass

    def delete_session(self, session_id: str) -> None:
        """
        Delete a session directory entirely.

        Args:
            session_id: Session identifier.
        """
        import shutil
        session_dir = self._session_dir(session_id)
        if session_dir.exists():
            shutil.rmtree(session_dir)

    def list_session_ids(self) -> list[str]:
        """
        List all session IDs that have metadata files.

        Returns:
            List of session IDs.
        """
        session_ids = []
        for item in self.sessions_dir.iterdir():
            if item.is_dir() and (item / "meta.json").exists():
                session_ids.append(item.name)
        return session_ids
