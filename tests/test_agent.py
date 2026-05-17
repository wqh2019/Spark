"""
Tests for Agent.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from spark import Agent, tool
from spark.prompts import DEFAULT_SYSTEM_PROMPT


class TestAgentInit:
    """Tests for Agent initialization."""

    def test_default_init(self, monkeypatch):
        """Test agent initialization with defaults."""
        # Clear env vars to test defaults
        monkeypatch.delenv("OPENAI_MODEL", raising=False)
        monkeypatch.delenv("OPENAI_API_KEY", raising=False)
        monkeypatch.delenv("OPENAI_BASE_URL", raising=False)

        agent = Agent()
        assert agent.model == "gpt-4"
        assert agent.tools == []
        assert agent.system_prompt == DEFAULT_SYSTEM_PROMPT

    def test_custom_init(self):
        """Test agent initialization with custom values."""
        @tool
        def search(query: str) -> str:
            """Search."""
            return query

        agent = Agent(
            model="gpt-4-turbo",
            tools=[search],
            system_prompt="Custom prompt"
        )
        assert agent.model == "gpt-4-turbo"
        assert len(agent.tools) == 1
        assert agent.system_prompt == "Custom prompt"

    def test_env_var_config(self, monkeypatch):
        """Test agent reads config from environment variables."""
        monkeypatch.setenv("OPENAI_MODEL", "gpt-3.5-turbo")
        monkeypatch.setenv("OPENAI_API_KEY", "test-key")
        monkeypatch.setenv("OPENAI_BASE_URL", "https://api.example.com/v1")

        agent = Agent()
        assert agent.model == "gpt-3.5-turbo"


class TestAgentRun:
    """Tests for Agent run methods."""

    @pytest.mark.asyncio
    async def test_arun_no_tools(self):
        """Test async run without tools returns final response."""
        @tool
        def noop(x: str) -> str:
            """Noop."""
            return x

        agent = Agent(tools=[noop], api_key="test-key")

        # Mock the OpenAI client
        mock_message = MagicMock()
        mock_message.tool_calls = None
        mock_message.content = "Hello!"

        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=mock_message)]

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = mock_response

            result = await agent.arun("Hi")
            assert result == "Hello!"

    @pytest.mark.asyncio
    async def test_arun_with_tool_call(self):
        """Test async run with tool execution."""
        @tool
        def echo(text: str) -> str:
            """Echo the input."""
            return f"Echo: {text}"

        agent = Agent(tools=[echo], api_key="test-key")

        # First call: with tool call
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.function.name = "echo"
        mock_tool_call.function.arguments = '{"text": "hello"}'

        mock_message1 = MagicMock()
        mock_message1.tool_calls = [mock_tool_call]
        mock_message1.model_dump.return_value = {
            "role": "assistant",
            "tool_calls": [mock_tool_call]
        }

        # Second call: final response
        mock_message2 = MagicMock()
        mock_message2.tool_calls = None
        mock_message2.content = "Done!"

        mock_response1 = MagicMock()
        mock_response1.choices = [MagicMock(message=mock_message1)]

        mock_response2 = MagicMock()
        mock_response2.choices = [MagicMock(message=mock_message2)]

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = [mock_response1, mock_response2]

            result = await agent.arun("Test")
            assert result == "Done!"

    @pytest.mark.asyncio
    async def test_arun_max_steps(self):
        """Test agent stops at max steps."""
        @tool
        def loop_tool(x: str) -> str:
            """A tool that always returns."""
            return x

        agent = Agent(tools=[loop_tool], api_key="test-key")

        # Always return a tool call
        mock_tool_call = MagicMock()
        mock_tool_call.id = "call_123"
        mock_tool_call.function.name = "loop_tool"
        mock_tool_call.function.arguments = '{"x": "test"}'

        mock_message = MagicMock()
        mock_message.tool_calls = [mock_tool_call]
        mock_message.model_dump.return_value = {
            "role": "assistant",
            "tool_calls": [mock_tool_call]
        }

        mock_response = MagicMock()
        mock_response.choices = [MagicMock(message=mock_message)]

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = mock_response

            result = await agent.arun("Test", max_steps=2)
            assert "maximum steps" in result.lower()


class TestExecuteTool:
    """Tests for _execute_tool method."""

    @pytest.mark.asyncio
    async def test_execute_sync_tool(self):
        """Test executing a synchronous tool."""
        @tool
        def add(a: int, b: int) -> int:
            """Add two numbers."""
            return a + b

        agent = Agent(tools=[add])

        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "add"
        mock_tool_call.function.arguments = '{"a": 1, "b": 2}'

        result = await agent._execute_tool(mock_tool_call)
        assert result == "3"

    @pytest.mark.asyncio
    async def test_execute_async_tool(self):
        """Test executing an asynchronous tool."""
        @tool
        async def async_add(a: int, b: int) -> int:
            """Add two numbers asynchronously."""
            return a + b

        agent = Agent(tools=[async_add])

        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "async_add"
        mock_tool_call.function.arguments = '{"a": 1, "b": 2}'

        result = await agent._execute_tool(mock_tool_call)
        assert result == "3"

    @pytest.mark.asyncio
    async def test_tool_not_found(self):
        """Test error when tool not found."""
        agent = Agent(tools=[])

        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "nonexistent"
        mock_tool_call.function.arguments = '{}'

        result = await agent._execute_tool(mock_tool_call)
        assert "not found" in result

    @pytest.mark.asyncio
    async def test_invalid_json_arguments(self):
        """Test error when arguments are not valid JSON."""
        @tool
        def test_tool(x: str) -> str:
            """Test tool."""
            return x

        agent = Agent(tools=[test_tool])

        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "test_tool"
        mock_tool_call.function.arguments = 'not valid json'

        result = await agent._execute_tool(mock_tool_call)
        assert "Invalid JSON" in result

    @pytest.mark.asyncio
    async def test_tool_exception(self):
        """Test error when tool raises exception."""
        @tool
        def failing_tool(x: str) -> str:
            """A tool that fails."""
            raise ValueError("Intentional error")

        agent = Agent(tools=[failing_tool])

        mock_tool_call = MagicMock()
        mock_tool_call.function.name = "failing_tool"
        mock_tool_call.function.arguments = '{"x": "test"}'

        result = await agent._execute_tool(mock_tool_call)
        assert "Error executing" in result


def test_agent_with_logger():
    """Test that agent accepts and uses logger."""
    import tempfile
    from pathlib import Path
    from spark.logging import AgentLogger

    with tempfile.TemporaryDirectory() as tmpdir:
        logger = AgentLogger(
            log_dir=Path(tmpdir),
            enable_console=False,
            enable_file=True,
        )

        @tool
        def echo(text: str) -> str:
            """Echo the input text."""
            return text

        agent = Agent(model="gpt-4", tools=[echo], logger=logger)

        # Logger should be attached
        assert agent.logger is logger
