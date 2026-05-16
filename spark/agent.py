"""
Spark Agent - Core agent implementation with ReAct loop.
"""

import asyncio
import json
import os
import time
from typing import Any, AsyncGenerator

from openai import AsyncOpenAI

from spark.prompts import DEFAULT_SYSTEM_PROMPT
from spark.schema import build_tool_schema
from spark.tool import Tool


class _SimpleToolCall:
    """Simple tool call object for internal use in arun_stream."""

    def __init__(self, data: dict):
        self.id = data["id"]
        self.function = _SimpleFunction(data["name"], data["arguments"])


class _SimpleFunction:
    """Simple function object for _SimpleToolCall."""

    def __init__(self, name: str, arguments: str):
        self.name = name
        self.arguments = arguments


class Agent:
    """
    A lightweight agent that runs a ReAct loop with OpenAI-compatible LLMs.

    Args:
        model: The model to use (e.g., "gpt-4", "gpt-4-turbo"). Falls back to OPENAI_MODEL env var.
        tools: List of tools available to the agent
        system_prompt: System prompt for the agent. Falls back to DEFAULT_SYSTEM_PROMPT.
        api_key: OpenAI API key. Falls back to OPENAI_API_KEY env var.
        base_url: API base URL. Falls back to OPENAI_BASE_URL env var.
        logger: Optional logger instance (e.g., AgentLogger) for tracing agent operations.
    """

    def __init__(
        self,
        model: str | None = None,
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
        logger: Any | None = None,
    ):
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4")
        self.tools = tools or []
        self.system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        self._tool_map = {t.name: t for t in self.tools}
        self.logger = logger

        # Store config for lazy client initialization
        self._api_key = api_key
        self._base_url = base_url
        self._client: AsyncOpenAI | None = None
        self._tool_schema: list[dict] | None = None  # Cached tool schema

    @property
    def client(self) -> AsyncOpenAI:
        """Lazy initialization of OpenAI client."""
        if self._client is None:
            self._client = AsyncOpenAI(
                api_key=self._api_key or os.getenv("OPENAI_API_KEY"),
                base_url=self._base_url or os.getenv("OPENAI_BASE_URL"),
            )
        return self._client

    async def arun(self, message: str, max_steps: int = 10) -> str:
        """
        Run the agent asynchronously with a user message.

        Args:
            message: The user message to process
            max_steps: Maximum number of tool-calling steps

        Returns:
            The agent's final response
        """
        messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
            {"role": "user", "content": message},
        ]

        # Start trace
        if self.logger:
            self.logger.start_trace()

        for step in range(max_steps):
            # Log LLM start
            if self.logger:
                self.logger.log_llm_start(step=step, model=self.model)

            start_time = time.time()
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self._build_tool_schema(),
            )
            duration_ms = int((time.time() - start_time) * 1000)

            # Extract token usage
            prompt_tokens = getattr(response.usage, 'prompt_tokens', 0) if response.usage else 0
            completion_tokens = getattr(response.usage, 'completion_tokens', 0) if response.usage else 0

            # Log LLM end
            if self.logger:
                self.logger.log_llm_end(
                    step=step,
                    model=self.model,
                    prompt_tokens=prompt_tokens,
                    completion_tokens=completion_tokens,
                    duration_ms=duration_ms,
                )

            assistant_msg = response.choices[0].message

            if not assistant_msg.tool_calls:
                if self.logger:
                    self.logger.end_trace()
                return assistant_msg.content or ""

            messages.append(assistant_msg.model_dump())

            # Execute all tools in parallel
            tool_calls = assistant_msg.tool_calls
            results = await asyncio.gather(*[
                self._execute_tool_with_logging(tc, step) for tc in tool_calls
            ])

            # Add results to messages in order
            for tool_call, result in zip(tool_calls, results):
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

        if self.logger:
            self.logger.end_trace()
        return "Error: Reached maximum steps without completing the task."

    async def arun_stream(
        self,
        message: str,
        messages: list[dict[str, Any]],
        max_steps: int = 10,
    ) -> AsyncGenerator[dict[str, Any], None]:
        """
        Run the agent with streaming output.

        Args:
            message: The user message to process
            messages: Conversation history (list of message dicts)
            max_steps: Maximum number of tool-calling steps

        Yields:
            Event dictionaries with types:
            - {"type": "text_delta", "delta": "..."}
            - {"type": "tool_call", "name": "...", "args": {...}}
            - {"type": "tool_result", "name": "...", "result": "..."}
            - {"type": "done"}
            - {"type": "error", "message": "..."}
        """
        # Build full message list
        full_messages: list[dict[str, Any]] = [
            {"role": "system", "content": self.system_prompt},
            *messages,
            {"role": "user", "content": message},
        ]

        # Start trace
        if self.logger:
            self.logger.start_trace()

        for step in range(max_steps):
            try:
                # Log LLM start
                if self.logger:
                    self.logger.log_llm_start(step=step, model=self.model)

                start_time = time.time()
                stream = await self.client.chat.completions.create(
                    model=self.model,
                    messages=full_messages,
                    tools=self._build_tool_schema(),
                    stream=True,
                )

                # Collect streaming response
                content_chunks: list[str] = []
                tool_calls_data: dict[int, dict] = {}  # index -> tool call data

                async for chunk in stream:
                    delta = chunk.choices[0].delta

                    # Handle text content
                    if delta.content:
                        content_chunks.append(delta.content)
                        yield {"type": "text_delta", "delta": delta.content}

                    # Handle tool calls (streamed incrementally)
                    if delta.tool_calls:
                        for tc in delta.tool_calls:
                            idx = tc.index
                            if idx not in tool_calls_data:
                                tool_calls_data[idx] = {
                                    "id": tc.id or "",
                                    "name": "",
                                    "arguments": "",
                                }
                            if tc.function:
                                if tc.function.name:
                                    tool_calls_data[idx]["name"] = tc.function.name
                                if tc.function.arguments:
                                    tool_calls_data[idx]["arguments"] += tc.function.arguments

                # Log LLM end (streaming doesn't provide token counts)
                duration_ms = int((time.time() - start_time) * 1000)
                if self.logger:
                    self.logger.log_llm_end(
                        step=step,
                        model=self.model,
                        prompt_tokens=0,
                        completion_tokens=0,
                        duration_ms=duration_ms,
                    )

                # Process tool calls if any
                if tool_calls_data:
                    # Build assistant message for history
                    assistant_msg = {
                        "role": "assistant",
                        "content": "".join(content_chunks) or None,
                        "tool_calls": [],
                    }

                    for idx in sorted(tool_calls_data.keys()):
                        tc_data = tool_calls_data[idx]
                        tool_name = tc_data["name"]

                        # Yield tool call event
                        try:
                            args = json.loads(tc_data["arguments"])
                        except json.JSONDecodeError:
                            args = {}

                        yield {
                            "type": "tool_call",
                            "name": tool_name,
                            "args": args,
                        }

                        # Build tool call for message
                        tool_call_obj = {
                            "id": tc_data["id"],
                            "type": "function",
                            "function": {
                                "name": tool_name,
                                "arguments": tc_data["arguments"],
                            },
                        }
                        assistant_msg["tool_calls"].append(tool_call_obj)

                    full_messages.append(assistant_msg)

                    # Execute all tools in parallel
                    sorted_indices = sorted(tool_calls_data.keys())
                    tool_call_objs = [_SimpleToolCall(tool_calls_data[idx]) for idx in sorted_indices]
                    results = await asyncio.gather(*[
                        self._execute_tool_with_logging(tc, step) for tc in tool_call_objs
                    ])

                    # Yield results and add to messages in order
                    for idx, result in zip(sorted_indices, results):
                        tc_data = tool_calls_data[idx]
                        tool_name = tc_data["name"]

                        yield {
                            "type": "tool_result",
                            "name": tool_name,
                            "result": result,
                        }

                        full_messages.append({
                            "role": "tool",
                            "tool_call_id": tc_data["id"],
                            "content": result,
                        })

                    # Continue to next step
                    continue

                # No tool calls - we're done
                if self.logger:
                    self.logger.end_trace()
                yield {"type": "done"}
                return

            except Exception as e:
                if self.logger:
                    self.logger.end_trace()
                yield {"type": "error", "message": str(e)}
                return

        # Max steps reached
        if self.logger:
            self.logger.end_trace()
        yield {"type": "error", "message": "Reached maximum steps without completing the task."}

    def run(self, message: str, max_steps: int = 10) -> str:
        """
        Run the agent synchronously with a user message.

        Args:
            message: The user message to process
            max_steps: Maximum number of tool-calling steps

        Returns:
            The agent's final response
        """
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # Already in async context, create a task
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                future = executor.submit(asyncio.run, self.arun(message, max_steps))
                return future.result()
        else:
            return asyncio.run(self.arun(message, max_steps))

    async def _execute_tool(self, tool_call: Any) -> str:
        """
        Execute a tool call and return the result as a string.

        Args:
            tool_call: The tool call object from the LLM response

        Returns:
            The tool execution result or error message
        """
        tool_name = tool_call.function.name

        try:
            tool_args = json.loads(tool_call.function.arguments)
        except json.JSONDecodeError as e:
            return f"Error: Invalid JSON arguments for tool '{tool_name}': {e}"

        if tool_name not in self._tool_map:
            return f"Error: Tool '{tool_name}' not found"

        try:
            tool = self._tool_map[tool_name]
            result = tool.run(**tool_args)
            if asyncio.iscoroutine(result):
                result = await result
            return str(result)
        except Exception as e:
            return f"Error executing {tool_name}: {e}"

    async def _execute_tool_with_logging(self, tool_call: Any, step: int) -> str:
        """
        Execute a tool call with logging.

        Args:
            tool_call: The tool call object from the LLM response
            step: The current step number

        Returns:
            The tool execution result or error message
        """
        tool_name = tool_call.function.name

        try:
            tool_args = json.loads(tool_call.function.arguments)
        except json.JSONDecodeError as e:
            error_msg = f"Error: Invalid JSON arguments for tool '{tool_name}': {e}"
            if self.logger:
                self.logger.log_tool_end(step=step, tool_name=tool_name, error=error_msg)
            return error_msg

        if tool_name not in self._tool_map:
            error_msg = f"Error: Tool '{tool_name}' not found"
            if self.logger:
                self.logger.log_tool_end(step=step, tool_name=tool_name, error=error_msg)
            return error_msg

        # Log tool start
        if self.logger:
            self.logger.log_tool_start(step=step, tool_name=tool_name, tool_args=tool_args)

        start_time = time.time()
        try:
            tool = self._tool_map[tool_name]
            result = tool.run(**tool_args)
            if asyncio.iscoroutine(result):
                result = await result
            result_str = str(result)
            duration_ms = int((time.time() - start_time) * 1000)

            if self.logger:
                self.logger.log_tool_end(
                    step=step,
                    tool_name=tool_name,
                    tool_result=result_str[:500],  # Truncate for logging
                    duration_ms=duration_ms,
                )
            return result_str
        except Exception as e:
            error_msg = f"Error executing {tool_name}: {e}"
            duration_ms = int((time.time() - start_time) * 1000)
            if self.logger:
                self.logger.log_tool_end(
                    step=step,
                    tool_name=tool_name,
                    error=error_msg,
                    duration_ms=duration_ms,
                )
            return error_msg

    def _build_tool_schema(self) -> list[dict] | None:
        """
        Build the tools parameter for OpenAI API (cached).

        Returns:
            List of tool schemas or None if no tools
        """
        if not self.tools:
            return None
        if self._tool_schema is None:
            self._tool_schema = build_tool_schema(self.tools)
        return self._tool_schema

    def add_tool(self, tool: Tool) -> None:
        """Add a tool to the agent."""
        self.tools.append(tool)
        self._tool_map[tool.name] = tool
        self._tool_schema = None  # Invalidate cache
