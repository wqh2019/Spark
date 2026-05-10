"""
Spark Agent - Core agent implementation with ReAct loop.
"""

import asyncio
import json
import os
from typing import Any

from openai import AsyncOpenAI

from spark.prompts import DEFAULT_SYSTEM_PROMPT
from spark.schema import build_tool_schema
from spark.tool import Tool


class Agent:
    """
    A lightweight agent that runs a ReAct loop with OpenAI-compatible LLMs.

    Args:
        model: The model to use (e.g., "gpt-4", "gpt-4-turbo"). Falls back to OPENAI_MODEL env var.
        tools: List of tools available to the agent
        system_prompt: System prompt for the agent. Falls back to DEFAULT_SYSTEM_PROMPT.
        api_key: OpenAI API key. Falls back to OPENAI_API_KEY env var.
        base_url: API base URL. Falls back to OPENAI_BASE_URL env var.
    """

    def __init__(
        self,
        model: str | None = None,
        tools: list[Tool] | None = None,
        system_prompt: str | None = None,
        api_key: str | None = None,
        base_url: str | None = None,
    ):
        self.model = model or os.getenv("OPENAI_MODEL", "gpt-4")
        self.tools = tools or []
        self.system_prompt = system_prompt or DEFAULT_SYSTEM_PROMPT
        self._tool_map = {t.name: t for t in self.tools}

        # Store config for lazy client initialization
        self._api_key = api_key
        self._base_url = base_url
        self._client: AsyncOpenAI | None = None

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

        for step in range(max_steps):
            response = await self.client.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self._build_tool_schema(),
            )

            assistant_msg = response.choices[0].message

            if not assistant_msg.tool_calls:
                return assistant_msg.content or ""

            messages.append(assistant_msg.model_dump())

            for tool_call in assistant_msg.tool_calls:
                result = await self._execute_tool(tool_call)
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

        return "Error: Reached maximum steps without completing the task."

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

    def _build_tool_schema(self) -> list[dict] | None:
        """
        Build the tools parameter for OpenAI API.

        Returns:
            List of tool schemas or None if no tools
        """
        if not self.tools:
            return None
        return build_tool_schema(self.tools)

    def add_tool(self, tool: Tool) -> None:
        """Add a tool to the agent."""
        self.tools.append(tool)
        self._tool_map[tool.name] = tool
