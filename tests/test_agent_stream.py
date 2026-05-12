"""
Tests for Agent streaming functionality.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from spark import Agent, tool


@tool
def echo(text: str) -> str:
    """Echo the input text."""
    return text


class TestAgentStream:
    """Test suite for arun_stream method."""

    @pytest.mark.asyncio
    async def test_arun_stream_yields_text_deltas(self):
        """Test that arun_stream yields text delta events."""
        agent = Agent(tools=[], model="test-model", api_key="test-key")

        # Mock the streaming response
        mock_chunk1 = MagicMock()
        mock_chunk1.choices = [MagicMock()]
        mock_chunk1.choices[0].delta = MagicMock(content="Hello")
        mock_chunk1.choices[0].finish_reason = None

        mock_chunk2 = MagicMock()
        mock_chunk2.choices = [MagicMock()]
        mock_chunk2.choices[0].delta = MagicMock(content=" World")
        mock_chunk2.choices[0].finish_reason = "stop"

        # Create an async iterator for the mock stream
        async def mock_stream():
            yield mock_chunk1
            yield mock_chunk2

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.return_value = mock_stream()

            events = []
            async for event in agent.arun_stream("Hi", []):
                events.append(event)

            # Should have text_delta events and a done event
            assert len(events) >= 1
            text_deltas = [e for e in events if e["type"] == "text_delta"]
            assert len(text_deltas) == 2
            assert text_deltas[0]["delta"] == "Hello"
            assert text_deltas[1]["delta"] == " World"
            assert events[-1]["type"] == "done"

    @pytest.mark.asyncio
    async def test_arun_stream_handles_tool_calls(self):
        """Test that arun_stream handles tool calls correctly."""
        agent = Agent(tools=[echo], model="test-model", api_key="test-key")

        # First chunk: tool call start
        mock_tool_call_delta = MagicMock()
        mock_tool_call_delta.index = 0
        mock_tool_call_delta.id = "call_123"
        mock_tool_call_delta.function = MagicMock()
        mock_tool_call_delta.function.name = "echo"
        mock_tool_call_delta.function.arguments = '{"text": "test"}'

        mock_chunk1 = MagicMock()
        mock_chunk1.choices = [MagicMock()]
        mock_chunk1.choices[0].delta = MagicMock(content=None, tool_calls=[mock_tool_call_delta])
        mock_chunk1.choices[0].finish_reason = None

        # Second chunk: tool call complete, response after tool execution
        mock_chunk2 = MagicMock()
        mock_chunk2.choices = [MagicMock()]
        mock_chunk2.choices[0].delta = MagicMock(content="Done", tool_calls=None)
        mock_chunk2.choices[0].finish_reason = "stop"

        # Create async iterators for multiple stream responses
        async def mock_stream1():
            yield mock_chunk1

        async def mock_stream2():
            yield mock_chunk2

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = [mock_stream1(), mock_stream2()]

            events = []
            async for event in agent.arun_stream("Test", []):
                events.append(event)

            # Should have tool_call, tool_result, text_delta, and done events
            tool_call_events = [e for e in events if e["type"] == "tool_call"]
            tool_result_events = [e for e in events if e["type"] == "tool_result"]

            assert len(tool_call_events) == 1
            assert tool_call_events[0]["name"] == "echo"
            assert tool_call_events[0]["args"] == {"text": "test"}

            assert len(tool_result_events) == 1
            assert tool_result_events[0]["name"] == "echo"
            assert tool_result_events[0]["result"] == "test"

            assert events[-1]["type"] == "done"

    @pytest.mark.asyncio
    async def test_arun_stream_yields_error_on_exception(self):
        """Test that arun_stream yields error event on exception."""
        agent = Agent(tools=[], model="test-model", api_key="test-key")

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = Exception("API error")

            events = []
            async for event in agent.arun_stream("Hi", []):
                events.append(event)

            assert len(events) == 1
            assert events[0]["type"] == "error"
            assert "API error" in events[0]["message"]

    @pytest.mark.asyncio
    async def test_arun_stream_max_steps(self):
        """Test that arun_stream stops at max steps."""
        agent = Agent(tools=[echo], model="test-model", api_key="test-key")

        # Create a tool call that loops forever
        mock_tool_call_delta = MagicMock()
        mock_tool_call_delta.index = 0
        mock_tool_call_delta.id = "call_123"
        mock_tool_call_delta.function = MagicMock()
        mock_tool_call_delta.function.name = "echo"
        mock_tool_call_delta.function.arguments = '{"text": "loop"}'

        mock_chunk = MagicMock()
        mock_chunk.choices = [MagicMock()]
        mock_chunk.choices[0].delta = MagicMock(content=None, tool_calls=[mock_tool_call_delta])
        mock_chunk.choices[0].finish_reason = None

        # Use a factory function to create fresh generators for each call
        def make_mock_stream():
            async def mock_stream():
                yield mock_chunk
            return mock_stream()

        with patch.object(
            agent.client.chat.completions, "create", new_callable=AsyncMock
        ) as mock_create:
            mock_create.side_effect = lambda **kwargs: make_mock_stream()

            events = []
            async for event in agent.arun_stream("Test", [], max_steps=2):
                events.append(event)

            # Should end with an error about max steps
            assert events[-1]["type"] == "error"
            assert "maximum steps" in events[-1]["message"].lower()
